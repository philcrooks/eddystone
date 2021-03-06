"use strict"

process.env.NODE_ENV = 'test';

const requestDispatcher = require('../network/api_request_dispatcher');
const EventFactory = require('../network/event_factory');
const sinon = require('sinon');
const assert = require("assert");
const server = require('../stubs').HttpServer;
const network = require('../stubs').network;
const token = "01234-01234567-0123456789";
const foundType = "found";
const lostType = "lost";
const deviceRoute = "device/";
const proximityRoute = "proximity"
const uniqueId = "test-uuid";
const baseURL = "https://cj101d.ifdnrg.com/";
const echoURL = baseURL + deviceRoute + uniqueId;

describe("Event Factory", function() {
	const dispatcher = requestDispatcher.getSystemDispatcher();
	let factory;

	describe("Initialisation", function() {

		before(function() {
      factory = new EventFactory(baseURL, token);
    });

		it("Initialises correctly", function() {
  		assert.strictEqual(factory._baseURL, baseURL);
  		assert.strictEqual(factory._token, token);
  		assert.strictEqual(factory._deviceId, uniqueId);
  		assert.strictEqual(factory._lastHeartbeat, null);
  		assert.deepStrictEqual(factory._events, {});
		});

	});

	describe("All Event Types", function() {
		let factory;

		beforeEach(function() {
      server.initialize();
      server.respondWith("PUT", baseURL + deviceRoute + uniqueId, [201, JSON.stringify({})]);
      server.respondWith("POST", baseURL + proximityRoute, [201, JSON.stringify({})]);
      factory = new EventFactory(baseURL, token);
    });

		it("Sends Heartbeat Event", function() {
			factory.heartbeat();
			assert.strictEqual(server.queueLength(), 1);
			assert.strictEqual(server.firstInQueue().verb, "PUT");
			assert.strictEqual(server.firstInQueue().url, baseURL + deviceRoute + uniqueId);
			server.respond(); // Clean out the dispatcher queue
		});

		it("Sends Beacon Found Event", function() {
			const url = baseURL + proximityRoute;
	  	const beaconId = 'c4a000000001';
      const beaconRSSI = -90;
      const beaconTxPower = -72;

	  	factory.foundBeaconEvent({
	  		bid: [0xc4, 0xa0, 0, 0, 0, 1],
	  		rssi: beaconRSSI,
	  		txPower: beaconTxPower
	  	});

	  	assert.strictEqual(server.queueLength(), 1);
			assert.strictEqual(server.firstInQueue().verb, "POST");
			assert.strictEqual(server.firstInQueue().url, baseURL + proximityRoute);
			const content = JSON.parse(server.firstInQueue().content);
			assert.strictEqual(content.eventType, foundType);
		  assert.strictEqual(content.beaconId, beaconId);
		  assert.strictEqual(content.rssi, beaconRSSI);
		  assert.strictEqual(content.txPower, beaconTxPower)
		  assert.strictEqual(content.uuid, uniqueId);
		  assert.strictEqual(content.token, token);
			server.respond(); // Clean out the dispatcher queue
		});

		it("Sends Beacon Lost Event", function() {
	  	const beaconId = 'c4a000000001';
      const beaconRSSI = -90;
      const beaconMaxRSSI = -72;

	  	factory.lostBeaconEvent({
	  		bid: [0xc4, 0xa0, 0, 0, 0, 1],
	  		rssi: beaconRSSI,
	  		rssiMax: beaconMaxRSSI
	  	});

	  	assert.strictEqual(server.queueLength(), 1);
			assert.strictEqual(server.firstInQueue().verb, "POST");
			assert.strictEqual(server.firstInQueue().url, baseURL + proximityRoute);
			const content = JSON.parse(server.firstInQueue().content);
			assert.strictEqual(content.eventType, lostType);
		  assert.strictEqual(content.beaconId, beaconId);
		  assert.strictEqual(content.rssi, beaconRSSI);
		  assert.strictEqual(content.rssiMax, beaconMaxRSSI);		  
		  assert.strictEqual(content.uuid, uniqueId);
		  assert.strictEqual(content.token, token);
			server.respond(); // Clean out the dispatcher queue
		});
	});

	describe("Hearbeat without replacement", function() {
		let timestamp;
		let lastId;

		before(function() {
      server.initialize();
      server.respondWith("PUT", baseURL + deviceRoute + uniqueId, [201, JSON.stringify({})]);
      factory = new EventFactory(baseURL, token);
      dispatcher._queue = [];
    });

    it ("Sends heartbeat", function() {
    	const callback = sinon.spy();
    	assert.strictEqual(factory._lastHeartbeat, null);
    	factory.heartbeat(callback);
    	assert.strictEqual(factory._lastHeartbeat._request, server.requests[0]);
    	lastId = factory._lastHeartbeat.id;
    	server.respond();
    	assert.strictEqual(callback.callCount, 1);
      assert.strictEqual(callback.getCall(0).args[0], 201);
    	assert.strictEqual(factory._lastHeartbeat, null);
    });

    it ("Sends another heartbeat", function() {
    	const callback = sinon.spy();
    	assert.strictEqual(factory._lastHeartbeat, null);
    	factory.heartbeat(callback);
    	assert.strictEqual(factory._lastHeartbeat._request, server.requests[0]);
    	assert.notStrictEqual(factory._lastHeartbeat.id, lastId);
    	server.respond();
    	assert.strictEqual(callback.callCount, 1);
      assert.strictEqual(callback.getCall(0).args[0], 201);
    	assert.strictEqual(factory._lastHeartbeat, null);
    });

	});

	describe("Hearbeat with replacement", function() {
		let timestamp;
		let lastId;

		before(function() {
      server.initialize();
      server.respondWith("PUT", baseURL + deviceRoute + uniqueId, [201, JSON.stringify({})]);
      server.respondWith("GET", echoURL, [200], true);
      factory = new EventFactory(baseURL, token);
      network.online = false;
      dispatcher._offline();
      dispatcher._queue = [];
    });

    it ("Sends heartbeat", function() {
    	assert.strictEqual(factory._lastHeartbeat, null);
    	factory.heartbeat();
    	assert.strictEqual(dispatcher.queueLength, 1);
    	const event = dispatcher._queue[0];
    	assert.strictEqual(factory._lastHeartbeat.id, event.id);

    	lastId = event.id;
    	timestamp = event._options.content.timestamp;
    });

    it ("Overwrites heartbeat", function(done) {
      setTimeout(function(){
      	// Ensure timestamps are different
	    	factory.heartbeat();
	    	assert.strictEqual(dispatcher.queueLength, 1);
	    	const event = dispatcher._queue[0];
	    	assert.strictEqual(factory._lastHeartbeat.id, event.id);
	    	assert.notStrictEqual(lastId, event.id);
	    	assert.notStrictEqual(event._options.content.timestamp, timestamp);
        done();
      }, 50)
    });

    it ("Receives heartbeat response", function() {
    	network.online = true;
    	dispatcher._online();

    	assert.strictEqual(dispatcher.queueEmpty, true);
    	assert.strictEqual(server.queueLength(), 1);
    	server.respond();
    	assert.strictEqual(server.queueLength(), 0);
    	assert.strictEqual(factory._lastHeartbeat, null);
    })
	});

	describe("Event persistance", function() {

		before(function() {
      server.initialize();
      server.respondWith("POST", baseURL + proximityRoute, [201, JSON.stringify({})]);
      factory = new EventFactory(baseURL, token);
      dispatcher._queue = [];
    });

		it ("Persists beacon found events", function() {

	  	assert.strictEqual(Object.keys(factory._events).length, 0);

	  	const request = factory.foundBeaconEvent({
	  		bid: [0xc4, 0xa0, 0, 0, 0, 1],
	  		rssi: -90,
	  		txPower: -72
	  	});

	  	assert.strictEqual(Object.keys(factory._events).length, 1);
	  	assert.strictEqual(request, factory._events[request.id]);
		});

		it ("Persists beacon lost events", function() {

			assert.strictEqual(Object.keys(factory._events).length, 1);

	  	const request = factory.lostBeaconEvent({
	  		bid: [0xc4, 0xa0, 0, 0, 0, 1],
	  		rssi: -90,
	  		rssiMax: -80
	  	});

	  	assert.strictEqual(Object.keys(factory._events).length, 2);
	  	assert.strictEqual(request, factory._events[request.id]);
		});

		it ("Removes beacon found events from persistant storage", function() {
			server.respond();
			assert.strictEqual(Object.keys(factory._events).length, 0);	
		});


	});

});
