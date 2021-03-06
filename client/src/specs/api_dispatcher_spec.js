"use strict"

process.env.NODE_ENV = 'test';

const ApiRequest = require('../network/api_request');
const requestDispatcher = require('../network/api_request_dispatcher');
const sinon = require('sinon');
const assert = require("assert");
const server = require('../stubs').HttpServer;
const network = require('../stubs').network;
const baseURL = "https://cj101d.ifdnrg.com/";
const echoURL = baseURL + "device/test-uuid";
const route = "proximity";

describe("API Dispatcher", function() {
  const dispatcher = requestDispatcher.getSystemDispatcher();

  var apiRequest;
  const params = {
    type: 'found',
    datetime: new Date().toISOString(),
    beaconId: 'c4a000000001',
    address: 'DE:59:85:F2:EB:E9',
    RSSI: -90,
    txPower: -72,
    email: 'test@etive.org',
    key: '0000-000-000000'
  };
  const json = JSON.stringify(params);

  describe ("Sends Echo requests", function() {
    const callback = sinon.spy();

    beforeEach(function() {
      server.initialize();
      // will send an echo request at some point
      server.respondWith("GET", echoURL, [200]);
      server.respondWith("POST", baseURL + "beacon-log", [201, json]);
      network.online = false;
      dispatcher._queue = [];
      dispatcher._offline();
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false);
    });


    it("Sends Echo request", function () {
      assert.strictEqual(server.requests.length, 0);
      assert.strictEqual(dispatcher.queueLength, 2);

      network.online = true;
      dispatcher._online();

      assert.strictEqual(server.requests.length, 1); // The Echo request
      assert.strictEqual(server.requests[0].verb, "GET");
      assert.strictEqual(server.requests[0].url, echoURL);
      assert.strictEqual(dispatcher.queueLength, 2);
      server.respond()
    });

    it("Handles Echo timeout", function (done) {
      assert.strictEqual(server.requests.length, 0);
      assert.strictEqual(dispatcher.queueLength, 2);

      network.online = true;
      dispatcher._online();

      const request = server.requests[0];
      server.initialize()
      request.ontimeout();
      assert.strictEqual(server.requests.length, 0);

      setTimeout(function(){
        // wait for Echo to be resent
        assert.strictEqual(server.requests.length, 1);
        assert.strictEqual(server.requests[0].verb, "GET");
        assert.strictEqual(server.requests[0].url, echoURL);
        assert.strictEqual(dispatcher.queueLength, 2);
        server.respond()
        done();
      }, 150)
    });

    it("Handles Echo Error", function (done) {
      assert.strictEqual(server.requests.length, 0);
      assert.strictEqual(dispatcher.queueLength, 2);

      network.online = true;
      dispatcher._online();

      const request = server.requests[0];
      server.initialize()
      request.onerror();
      assert.strictEqual(server.requests.length, 0);

      setTimeout(function(){
        // wait for Echo to be resent
        assert.strictEqual(server.requests.length, 1);
        assert.strictEqual(server.requests[0].verb, "GET");
        assert.strictEqual(server.requests[0].url, echoURL);
        assert.strictEqual(dispatcher.queueLength, 2);
        server.respond();
        done();
      }, 150)
    });

    it("Empties the queue", function () {
      assert.strictEqual(server.requests.length, 0);
      assert.strictEqual(dispatcher.queueLength, 2);

      network.online = true;
      dispatcher._online();
      server.respond();

      assert.strictEqual(dispatcher.queueLength, 0);
      assert.strictEqual(server.requests.length, 2);
    });
  });

  describe ("Queue without timeouts", function() {
    const callback = sinon.spy();

    before(function() {
      server.initialize();
      // will send an echo request at some point
      server.respondWith("GET", echoURL, [200]);
      network.online = false;
      dispatcher._offline();
    });

    it("Enqueues three Requests", function () {

      server.respondWith("POST", baseURL + "beacon-log", [201, json]);

      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);

      assert.strictEqual(dispatcher.queueLength, 3);
      assert.strictEqual(server.requests.length, 0);
    });

    it("Empties the queue", function () {
      network.online = true;
      dispatcher._online();
      server.respond();

      assert.strictEqual(dispatcher.queueLength, 0);
      assert.strictEqual(server.requests.length, 3);
    });

    it("Sends the right requests", function () {
      server.respond();

      assert.strictEqual(callback.callCount, 3);

      let call = callback.getCall(0);
      assert.strictEqual(call.args[0], 201);
      assert.deepStrictEqual(call.args[1], params);
      call = callback.getCall(1);
      assert.strictEqual(call.args[0], 201);
      assert.deepStrictEqual(call.args[1], params);
      call = callback.getCall(2);
      assert.strictEqual(call.args[0], 201);
      assert.deepStrictEqual(call.args[1], params);
    });

    it("Rejects calls when buffer is full", function() {
      network.online = false;
      dispatcher._offline();
      callback.reset();

      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);
      new ApiRequest().makePostRequest(baseURL + "beacon-log", params, false, callback);

      assert.strictEqual(callback.callCount, 1);
      let call = callback.getCall(0);
      assert.strictEqual(call.args[0], 601);
      assert.strictEqual(call.args[1], null);

      // Flush all the requests
      network.online = true;
      dispatcher._online();
      server.respond(); // Will respond to the Echo request

      server.respond(); // Respond to the Post requests
      assert.strictEqual(callback.callCount, 6);
    })
  });

  describe ("Queue with timeouts", function() {
    const callback = sinon.spy();
    let status = undefined;
    let response = undefined;

    before(function(done) {
      server.initialize();
      // will send an echo request at some point
      server.respondWith("GET", echoURL, [200]);
      network.online = false;
      dispatcher._offline();

      server.respondWith("GET", baseURL + route, [200, json]);
      server.respondWith("POST", baseURL + route, [201, json]);

      new ApiRequest().makeGetRequest(baseURL + route, false, callback);
      new ApiRequest().makePostRequest(baseURL + route, params, true, function() {
        status = arguments[0];
        response = arguments[1];
        done();
      });
      new ApiRequest().makeGetRequest(baseURL + route, false, callback);
    });

    it("Expired one request after timeout", function () {
      assert.strictEqual(dispatcher.queueLength, 2);
      assert.strictEqual(server.requests.length, 0);
      assert.strictEqual(status, 600);
      assert.strictEqual(response, null);
    });

    it("Empties the queue", function () {
      network.online = true;
      dispatcher._online();

      server.respond() // To Echo request

      assert.strictEqual(dispatcher.queueLength, 0);
      assert.strictEqual(server.requests.length, 2);
    });

    it("Sends the right requests", function () {
      server.respond();

      assert.strictEqual(callback.callCount, 2);

      let call = callback.getCall(0);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
      call = callback.getCall(1);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
    });
  });

  describe ("Message times out after sending", function() {
    const callback = sinon.spy();
    let status = undefined;
    let response = undefined;
    const request = new ApiRequest();

    before(function(done) {
      server.initialize();
      network.online = true;

      server.respondWith("GET", baseURL + route, [200, json]);
      server.respondWith("POST", baseURL + route, [201, json]);

      request._request.loseRequest = true; // a feature of the test stub
      request.makePostRequest(baseURL + route, params, true, function() {
        status = arguments[0];
        response = arguments[1];
        done();
      });
      new ApiRequest().makeGetRequest(baseURL + route, false, callback);
      new ApiRequest().makeGetRequest(baseURL + route, false, callback);
    });

    it("All messages are sent", function () {
      assert.strictEqual(dispatcher.queueLength, 0);
    });

    it("One message is lost", function () {
      assert.strictEqual(server.requests.length, 2);
    });

    it("Returns network timeout error", function () {
      assert.strictEqual(request.retries, 0);
      assert.strictEqual(status, 600);
      assert.strictEqual(response, null);
    });

    it("Correct replies received", function () {
      server.respond();

      assert.strictEqual(callback.callCount, 2);

      let call = callback.getCall(0);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
      call = callback.getCall(1);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
    });
  });

  describe ("Message times out but is automatically resent", function() {
    const callback = sinon.spy();
    let status = undefined;
    let response = undefined;
    const request = new ApiRequest();

    before(function(done) {
      server.initialize();
      network.online = true;

      server.respondWith("GET", baseURL + route, [200, json], true); // auto respond i.e. don't wait
      request._request.loseRequest = true; // a feature of the test stub - only loses first request
      request.makeGetRequest(baseURL + route, false, function() {
        status = arguments[0];
        response = arguments[1];
        done();
      });
    });

    it("Sends the message", function () {
      assert.strictEqual(dispatcher.queueLength, 0);
    });

    it("Resends the message", function () {
      assert.strictEqual(request.retries, 1);
    });

    it("Returns the correct data", function () {
      assert.strictEqual(status, 200);
      assert.deepStrictEqual(response, params);
    });
  });

  describe ("Message times out & network is offline so requeued", function() {
    const callback = sinon.spy();
    const request = new ApiRequest();

    before(function(done) {
      server.initialize();
      // will send an echo request at some point
      server.respondWith("GET", echoURL, [200]);
      network.online = true;

      server.respondWith("GET", baseURL + route, [200, json]);
      request._request.loseRequest = true; // a feature of the test stub - will only lose the first request
      request.makeGetRequest(baseURL + route, false, callback);
      setTimeout(function(){
        network.online = false;
        dispatcher._offline();
        setTimeout(function(){
          // wait for request to complete
          done();
        }, 100) // For test network timeout is 100ms
      }, 50)
    });

    it("Sent the message", function () {
      assert.strictEqual(request._tries, 1);
    });

    it("Requeues the message", function () {
      assert.strictEqual(dispatcher.queueLength, 1);
    });

    it("Empties the queue", function (done) {
      network.online = true;
      dispatcher._online();

      server.respond() // To Echo request

      setTimeout(function() {
        assert.strictEqual(dispatcher.queueLength, 0);
        assert.strictEqual(server.requests.length, 1);
        done();
      }, 1500)
    });

    it("Returns the correct data", function () {
      server.respond();

      assert.strictEqual(callback.callCount, 1);

      let call = callback.getCall(0);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
    });
  });

  describe ("Messages time out & network is offline so requeued in the original order", function() {
    const callback = sinon.spy();
    const request1 = new ApiRequest();
    const request2 = new ApiRequest();
    const request3 = new ApiRequest();
    let id1 = 0;
    let id2 = 0;
    let id3 = 0;

    before(function(done) {
      server.initialize();
      // will send an echo request at some point
      server.respondWith("GET", echoURL, [200]);
      network.online = true;

      server.respondWith("GET", baseURL + route, [200, json]);

      request1._request.loseRequest = true; // a feature of the test stub - will only lose the first request
      request1.makeGetRequest(baseURL + route, false, callback);
      id1 = request1.id;
      request2._request.loseRequest = true;
      request2.makeGetRequest(baseURL + route, false, callback);
      id2 = request2.id;
      setTimeout(function(){
        network.online = false;
        dispatcher._offline();
        request3.makeGetRequest(baseURL + route, false, callback);
        id3 = request3.id;
        setTimeout(function(){
          // wait for sent requests to timeout
          done();
        }, 100) // For test network timeout is 100ms
      }, 50)
    });

    it("Sent the messages", function () {
      assert.strictEqual(request1._tries, 1);
      assert.strictEqual(request2._tries, 1);
      assert.strictEqual(request3._tries, 0);
    });

    it("Requeues the message", function () {
      assert.strictEqual(dispatcher.queueLength, 3);
    });

    it("Messages are in the right order", function () {
      assert.strictEqual(dispatcher._queue[0].id, id1);
      assert.strictEqual(dispatcher._queue[1].id, id2);
      assert.strictEqual(dispatcher._queue[2].id, id3);
    });

    it("Empties the queue", function (done) {
      network.online = true;
      dispatcher._online();

      server.respond() // To Echo request

      setTimeout(function() {
        assert.strictEqual(dispatcher.queueLength, 0);
        assert.strictEqual(server.requests.length, 3);
        done();
      }, 1500);
    });

    it("Returns the correct data", function () {
      server.respond();

      assert.strictEqual(callback.callCount, 3);

      let call = callback.getCall(0);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
      call = callback.getCall(1);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
      call = callback.getCall(2);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], params);
    });
  });

  describe('Handles network issues:', function() {
    const regionUrl = baseURL + "region";
    const callback = sinon.spy();
    const regions = {
      "changed": 1497344487627,
      "regions": [
        {
          "point": {
            "lat": 52.558301,
            "lng": -1.823587
          },
          "radius": 25
        },
        {
          "point": {
            "lat": 52.578182,
            "lng": -1.804926
          },
          "radius": 25
        },
        {
          "point": {
            "lat": 52.582995,
            "lng": -1.828277
          },
          "radius": 25
        }
      ]
    };
    const regionJson = JSON.stringify(regions);

    beforeEach(function() {
      server.initialize();
      network.online = true;
      callback.reset();
    });

    it('Handles Timeouts', function(){
      new ApiRequest().makeGetRequest(regionUrl, false, callback);
      // Ignore the region request and report a network timeout
      assert.strictEqual(server.requests.length, 1);
      assert.strictEqual(callback.callCount, 0);

      const request = server.requests[0];
      server.initialize(); // Make server forget about the request 
      server.respondWith("GET", regionUrl, [200, regionJson]);

      assert.strictEqual(server.requests.length, 0);
      request.ontimeout();

      // The message should be resent immediately

      assert.strictEqual(server.requests.length, 1);
      server.respond();
      assert.strictEqual(callback.callCount, 1);
      const call = callback.getCall(0);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], regions);
    })

    it('Handles Errors', function(){
      new ApiRequest().makeGetRequest(regionUrl, false, callback);
      // Ignore the region request and report a network timeout
      assert.strictEqual(server.requests.length, 1);
      assert.strictEqual(callback.callCount, 0);

      const request = server.requests[0];
      server.initialize(); // Make server forget about the request 
      server.respondWith("GET", regionUrl, [200, regionJson]);

      assert.strictEqual(server.requests.length, 0);
      request.onerror();

      // The message should be resent immediately
      assert.strictEqual(server.requests.length, 1);
      server.respond();
      assert.strictEqual(callback.callCount, 1);
      const call = callback.getCall(0);
      assert.strictEqual(call.args[0], 200);
      assert.deepStrictEqual(call.args[1], regions);
    })
  })
});
