"use strict"

process.env.NODE_ENV = 'test';

const sinon = require('sinon');
const assert = require("assert");
const Repository = require('../network/repository');
const network = require('../stubs').network;
const server = require('../stubs').HttpServer;
const localStorage = require('../stubs').localStorage;
const apiKey = require('../keys').localRepository;

const baseURL = "https://cj101d.ifdnrg.com/api/";
const beaconLog = "proximity";
const tokenKey = "token";
const regionsKey = "regions";
const token = "01234-01234567-0123456789";

describe("Repository Requests", function() {
	const position = {
		latitude: 55.88358,
		longitude: -3.08531,
		accuracy: 24.644
	}
	const timestamp = new Date("1981-03-21").getTime();

  describe("All Request Types", function() {
		const repository = new Repository(baseURL);

	  beforeEach(function() {
	    server.initialize();
	    network.online = true;
	  });

	  after(function() {
	  	repository._stopTimers();
	  });

	  it('Won\'t send a request without authorisation', function() {
	  	const url = baseURL + beaconLog;

	  	repository.heartbeat();
	  	repository.foundBeacon();
	  	repository.lostBeacon();
	  	repository._fetchRegions();

	  	assert.strictEqual(server.requests.length, 0);
	  });

	  it('Authorizes a user', function() {
	  	const email = "test@etive.org";
	  	const receiverUrl = baseURL + "receiver/" + encodeURIComponent(email) + "?key=" + encodeURIComponent(apiKey);
	  	const deviceUrl = baseURL + "device"
	  	const receiverJson = JSON.stringify({id: 1, token: token});
	  	const deviceInfo = {
	  		os: "Test OS",
	  		osVersion: "Test Version",
	  		model: "Test Model",
	  		uuid: "Test UUID",
	  		token: token
	  	}

	  	server.respondWith("GET", receiverUrl, [200, receiverJson]);
	  	server.respondWith("POST", deviceUrl, [201, JSON.stringify(deviceInfo)])

	  	repository.authorize(email);
	  	assert.strictEqual(server.requests.length, 1)
	    assert.strictEqual(server.requests[0].verb, "GET");
	    assert.strictEqual(server.requests[0].url, receiverUrl);
			assert.strictEqual(server.requests[0].content, null);

	    server.respond();

	    assert.strictEqual(repository._token, token);

    	assert.strictEqual(server.requests.length, 1)
      assert.strictEqual(server.requests[0].verb, "POST");
      assert.strictEqual(server.requests[0].url, deviceUrl);
  		assert.strictEqual(server.requests[0].content, JSON.stringify(deviceInfo));

  		server.respond(); // This will start the timers and send a region request

  		assert.strictEqual(repository._stopTimers(), 2);
	    assert.strictEqual(localStorage.getItem(tokenKey), token);
	  });

	  it('Creates a request using authorisation', function() {
	  	const url = baseURL + "device/test-uuid";

	  	repository.heartbeat();

	  	assert.strictEqual(server.requests[0].verb, "PUT");
	  	assert.strictEqual(server.requests[0].url, url);

			const content = JSON.parse(server.requests[0].content);
	    assert.strictEqual(content.token, token);
	    assert.strictEqual(content.timestamp > 0, true);
	  });

	  it('Creates a Found Beacon request', function() {
	  	const url = baseURL + beaconLog;
	  	const beaconId = 'c4a000000001';
      const beaconAddress = 'DE:59:85:F2:EB:E9';
      const beaconRSSI = -90;
      const beaconTxPower = -72;

	  	repository.foundBeacon({
	  		bid: [0xc4, 0xa0, 0, 0, 0, 1],
	  		address: beaconAddress,
	  		rssi: beaconRSSI,
	  		txPower: beaconTxPower
	  	});

	    assert.strictEqual(server.requests[0].verb, "POST");
	    assert.strictEqual(server.requests[0].url, url);
			assert.notStrictEqual(server.requests[0].content, null);

			const content = JSON.parse(server.requests[0].content);
	    assert.strictEqual(content.eventType, "found");
	    assert.strictEqual(content.timestamp > 0, true);
	    assert.strictEqual(content.beaconId, beaconId);
	    assert.strictEqual(content.rssi, beaconRSSI);
	    assert.strictEqual(content.txPower, beaconTxPower);
	    assert.strictEqual(content.token, token);
	  });

	  it('Doesn\'t create a Lost Beacon request if beacon unconfirmed', function() {
	  	const url = baseURL + beaconLog;
	  	const beaconId = 'c4a000000001';
      const beaconAddress = 'DE:59:85:F2:EB:E9';
      const beaconRSSI = -90;
      const beaconMaxRSSI = -72;

	  	repository.lostBeacon({
	  		bid: [0xc4, 0xa0, 0, 0, 0, 1],
	  		address: beaconAddress,
	  		rssi: beaconRSSI,
	  		rssiMax: beaconMaxRSSI,
	  		confirmed: false
	  	});

	    assert.strictEqual(server.requests.length, 0);
	  });

	  it('Creates a Lost Beacon request if beacon confirmed', function() {
	  	const url = baseURL + beaconLog;
	  	const beaconId = 'c4a000000001';
      const beaconAddress = 'DE:59:85:F2:EB:E9';
      const beaconRSSI = -90;
      const beaconMaxRSSI = -72;

	  	repository.lostBeacon({
	  		bid: [0xc4, 0xa0, 0, 0, 0, 1],
	  		address: beaconAddress,
	  		rssi: beaconRSSI,
	  		rssiMax: beaconMaxRSSI,
	  		confirmed: true
	  	});

	    assert.strictEqual(server.requests[0].verb, "POST");
	    assert.strictEqual(server.requests[0].url, url);
			assert.notStrictEqual(server.requests[0].content, null);

			const content = JSON.parse(server.requests[0].content);
	    assert.strictEqual(content.eventType, "lost");
	    assert.strictEqual(content.timestamp > 0, true);
	    assert.strictEqual(content.beaconId, beaconId);
	    assert.strictEqual(content.rssi, beaconRSSI);
	    assert.strictEqual(content.rssiMax, beaconMaxRSSI);
	    assert.strictEqual(content.token, token);
	  });
	});

  describe("Automatic (heartbeat and region) messages not sent when not authorized", function() {
  	let repository = null;

  	// Automatic sending of hearbeat messages is triggered when the repository is created

	  before(function(done) {
	  	localStorage.clear();
	    server.initialize();
	    network.online = true;
  	  repository = new Repository(baseURL, 1000);
	    setTimeout(function() {
	    	done();
	    }, 1500)
	  });

	  after(function() {
	  	repository._stopTimers();
	  });

	  it('Doesn\'t send any heartbeat or region messages', function() {
	  	assert.strictEqual(repository._token, null);
	  	assert.strictEqual(repository.hasToken, false);
	  	assert.strictEqual(server.requests.length, 0);
	  });

	});

  describe("Automatic (heartbeat and region) messages are sent as soon as authorized", function() {
  	let repository = null;

  	// Automatic sending of hello messages is triggered when the repository is created
  	// In the test environment the messages are sent every 0.5 seconds

	  before(function() {
  		localStorage.clear();
	    server.initialize();
	    network.online = true;
  	  repository = new Repository(baseURL, 1000);
	  });

	  after(function() {
	  	repository._stopTimers();
	  });

	  it('Sends heartbeat and region messages after authorization', function(done) {
	  	const email = "test@etive.org";
	  	const receiverUrl = baseURL + "receiver/" + encodeURIComponent(email) + "?key=" + encodeURIComponent(apiKey);
	  	const deviceUrl = baseURL + "device";
	  	const regionUrl = baseURL + "region";
	  	const receiverJson = JSON.stringify({id: 1, token: token});
	  	const deviceInfo = {
	  		os: "Test OS",
	  		osVersion: "Test Version",
	  		model: "Test Model",
	  		uuid: "Test UUID",
	  		token: token
	  	}

	  	server.respondWith("GET", receiverUrl, [200, receiverJson]);
	  	server.respondWith("POST", deviceUrl, [201, JSON.stringify(deviceInfo)])

	  	repository.authorize(email);

	    server.respond(); // To release the GET request
	    server.respond(); // To release the POST request

	    setTimeout(function() {
	  		assert.strictEqual(repository._token, token);
	  		assert.notStrictEqual(repository._regionTimer, null);
	  	  assert.notStrictEqual(repository._heartbeatTimer, null);

	  	  // Don't issue an immediate hearbeat in this scenario so request count only 1
		  	assert.strictEqual(server.requests.length, 2);
		  	// region request sent first in this case
		  	assert.strictEqual(server.requests[0].verb, "GET");
		  	assert.strictEqual(server.requests[0].url, regionUrl);
		  	assert.strictEqual(server.requests[1].verb, "PUT");
		  	assert.strictEqual(server.requests[1].url, deviceUrl + "/test-uuid");
		  	let content = JSON.parse(server.requests[1].content);
		  	assert.strictEqual(content.token, token);
	    	done();
	    }, 1500);
	  });
	});

	 describe("Automatic heartbeat and region messages sent immediately if already authorized", function() {
  	let repository = null;
  	const deviceUrl = baseURL + "device"
  	const regionUrl = baseURL + "region";

  	// Automatic sending of hello messages is triggered when the repository is created
  	// In the test environment the messages are sent every 1 second starting as soon as instantiated
  	// Two hello messages should be sent

	  before(function(done) {
	  	localStorage.clear();
	    server.initialize();
	    network.online = true;
	    localStorage.setItem(tokenKey, token);
  	  repository = new Repository(baseURL, 1000);
	    setTimeout(function() {
	    	done();
	    }, 1500)
	    // In 1.5 seconds should get two heartbeat messages and one region request
	  });

	  after(function() {
	  	repository._stopTimers();
	  });

	  it('Sends heartbeat messages on instantiation', function() {
	  	assert.strictEqual(repository._token, token);
	  	assert.strictEqual(repository.hasToken, true);
	  	assert.notStrictEqual(repository._heartbeatTimer, null);
	  	assert.notStrictEqual(repository._regionTimer, null);

	  	// Issue an immediate heartbeat in this scenario so request count is 2
	  	assert.strictEqual(server.requests.length, 3);
	  	assert.strictEqual(server.requests[0].verb, "PUT");
	  	assert.strictEqual(server.requests[0].url, deviceUrl + "/test-uuid");
	  	let content = JSON.parse(server.requests[0].content);
	  	assert.strictEqual(content.token, token);
	  	assert.strictEqual(server.requests[1].verb, "GET");
	  	assert.strictEqual(server.requests[1].url, regionUrl);
	  	assert.strictEqual(server.requests[2].verb, "PUT");
	  	assert.strictEqual(server.requests[2].url, deviceUrl + "/test-uuid");
	  	content = JSON.parse(server.requests[2].content);
	  	assert.strictEqual(content.token, token);
	  });
	});

	describe('Sends track request', function() {
		const deviceUrl = baseURL + "device"
		const regionUrl = baseURL + "region";
		let repository = null;

	  before(function() {
	    server.initialize();
	    network.online = true;
	    localStorage.setItem(tokenKey, token);
	    // Make sure the first heartbeat is a long time in the future
  	  repository = new Repository(baseURL, 10000000);
  	  // Will immediately send heartbeat and region requests
	  });

	  after(function() {
	  	repository._stopTimers();
	  });

	  it('Sends correct arguments', function() {
	  	assert.strictEqual(server.requests.length, 2);
	  	assert.strictEqual(server.requests[0].verb, "PUT");
	  	assert.strictEqual(server.requests[0].url, deviceUrl + "/test-uuid");
	  	assert.strictEqual(server.requests[1].verb, "GET");
	  	assert.strictEqual(server.requests[1].url, regionUrl);
	  })
	})
});