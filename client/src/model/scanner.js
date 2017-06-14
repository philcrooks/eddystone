"use strict"

const Scan = require('./scan');
const logger = require('../utility').logger;
const positionToString = require('../utility').positionToString;

const minScanLength = 10000; // milliseconds
const desiredAccuracy = 100; // metres
const marginOfError = desiredAccuracy;

const Scanner = function(repository, onStatusChange){
  this._repository = repository;
  this._onStatusChange = onStatusChange;
  this._scanStartTime = null;
  this._startGeolocationPending = false;
  this._stopScanPending = false;
  this._stationary = null;
  this._scan = new Scan(
    this._repository.foundBeacon.bind(this._repository),
    this._repository.lostBeacon.bind(this._repository),
    function(errorCode) { this._onStatusChange("Scan Error: " + errorCode) }.bind(this)
  );

  backgroundGeolocation.configure(
    this._movedTo.bind(this),
    this._onGeoError.bind(this),
    {
      desiredAccuracy: desiredAccuracy,
      stationaryRadius: 5,
      distanceFilter: 5,
      stopOnTerminate: true,
      // locationProvider: backgroundGeolocation.provider.ANDROID_DISTANCE_FILTER_PROVIDER
      locationProvider: backgroundGeolocation.provider.ANDROID_ACTIVITY_PROVIDER,
      interval: 15000,
      fastestInterval: 5000,
      activitiesInterval: 30000
    }
  );
  backgroundGeolocation.onStationary(this._stationaryAt.bind(this), this._onGeoError)
  backgroundGeolocation.watchLocationMode(this._geolocationModeChange.bind(this), this._onGeoError)

  Object.defineProperty(this, "beacons",
    { get: function(){ return this._scan.beacons; } }
  );
};

Scanner.prototype._startGeolocation = function() {
  logger("Geolocation starting")
  backgroundGeolocation.start();
  this._startGeolocationPending = false;
}

Scanner.prototype._startScan = function() {
  if (this._stopScanPending) this._stopScanPending = false;
  if (this._scanStartTime) return;
  logger("Starting the scan")
  this._scan.start();
  this._scanStartTime = Date.now();
  this._onStatusChange("Scanning..."); 
}

Scanner.prototype._stopScan = function() {

  const stopNow = function(scanner) {
    // Don't stop the scan if the pending flag has been reset by a _startScan() request
    if (!scanner._stopScanPending) return;
    logger("Pausing the scan")
    scanner._scan.stop();
    scanner._scanStartTime = null;
    scanner._stopScanPending = false;
    scanner._onStatusChange("Scanning paused");
  }

  if (!this._scanStartTime) return;
  logger("Scan pause requested")
  const diff = Date.now() - this._scanStartTime;
  this._stopScanPending = true;
  if (diff >= minScanLength)
    stopNow(this);
  else
    setTimeout(function() { stopNow(this) }.bind(this), minScanLength - diff);
}

Scanner.prototype._metresBetween = function( latLngA, latLngB ) {

  // Haversine
  // formula:  a = sin²(Δφ/2) + cos φ1 ⋅ cos φ2 ⋅ sin²(Δλ/2)
  // c = 2 ⋅ atan2( √a, √(1−a) )
  // d = R ⋅ c
  // where φ is latitude, λ is longitude, R is earth’s radius (mean radius = 6,371km);
  // note that angles need to be in radians to pass to trig functions!

  function toRadians(x) {
    return x * Math.PI / 180;
  }

  const R = 6371e3; // metres
  const φ1 = toRadians(latLngA.lat);
  const φ2 = toRadians(latLngB.lat);
  const Δφ = toRadians(latLngB.lat - latLngA.lat);
  const Δλ = toRadians(latLngB.lng - latLngA.lng);

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const d = R * c;

  return d;
}

Scanner.prototype._nearBeacons = function(geoLocation) {
  if (!this._repository.regions) return true;

  const position = { lat: geoLocation.latitude, lng: geoLocation.longitude };
  const accuracy = geoLocation.accuracy;

  for (let region of this._repository.regions) {
    // Check if region and position centres are closer together than the sum of the radii
    // If they are then return true
    const d = this._metresBetween(region.point, position);
    if (d < (region.radius + marginOfError + accuracy)) {
      logger("Beacons in range:", Math.round(d), "metres away or less")
      return true;
    }
  }
  return false;
}

Scanner.prototype._recordStationaryTime = function() {
  const now = Date.now();
  const secondsStationary = Math.round((now - this._stationary.time) / 1000);
  logger("Time stationary", Math.round(secondsStationary * 10 / 6) / 100, "minutes");
  this._repository.trackStationary(this._stationary.position, now, secondsStationary)
}

Scanner.prototype._movedTo = function(position) {
  // Sometimes a phone "moves" to the same location at which it was stationary
  // This move is disregarded
  if (this._stationary && ((this._stationary.position.latitude !== position.latitude) ||
    (this._stationary.position.longitude !== position.longitude))) {
    this._recordStationaryTime()
    this._stationary = null;
  }

  // Only scan whilest close to beacons
  if (this._nearBeacons(position))
    this._startScan();
  else
    this._stopScan();
  backgroundGeolocation.finish();
};

Scanner.prototype._stationaryAt = function(position) {
  // If there is a already record of a stationary point - check to see if the phone has moved at all
  if (this._stationary && ((this._stationary.position.latitude !== position.latitude) ||
    (this._stationary.position.longitude !== position.longitude))) {
    // The phone has moved so record the amount of time the phone was static
    this._recordStationaryTime()
    this._stationary = null;
  }

  // If a move was disregarded (because the device did not move from the point it was stationary)
  // Then do NOT record another stationary event now
  if (!this._stationary) {
    logger("Stationary at", positionToString(position));
    this._stationary = { position: position, time: Date.now() };
    this._repository.trackStationary(this._stationary.position, this._stationary.time, 0)
  }

  // Don't scan whilst stationary
  this._stopScan();
  backgroundGeolocation.finish();
}

Scanner.prototype._geolocationModeChange = function(enabled) {
  // If the location service is not enabled have to scan all the time
  logger("Geolocation has been turned", (enabled) ? "on" : "off");
  if (!enabled)
    this._startScan();
  else
    if (this._startGeolocationPending) this._startGeolocation();
}

Scanner.prototype._onGeoError = function(geolocationError) {
  this._onStatusChange(geolocationError.message);
}

Scanner.prototype.start = function() {
  // this._onStatusChange("Scan pending.");
  // Start the scan immediately - if stationary it will be turned off quickly.
  this._startScan();
  // Turn ON the background-geolocation system.  The user will be tracked whenever they suspend the app.
  backgroundGeolocation.isLocationEnabled(function(enabled){
    this._startGeolocationPending = true;
    if (enabled) this._startGeolocation();
  }.bind(this), this._onGeoError);
}

Scanner.prototype.stop = function() {
  this._scan.stop();
  this._onStatusChange('Scanning stopped.');
  backgroundGeolocation.stop();
}

module.exports = Scanner;