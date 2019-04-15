#!/usr/bin/env node

const commands = require("./commands");
const log = require("./log.js").log;

function initConnection(request) {
	let ws = request.accept();
	log("ws connection accepted from origin", request.origin);

	let parts = (request.resourceURL.query.server || "").split(":");
	let host = parts[0] || "0";
	let port = Number(parts[1]) || 6600;
	log(`connecting to mpd at ${host}:${port}`);

	let mpd = new (require("net").Socket)();
	mpd.setTimeout(0);
	mpd.connect(port, host);

	let commandQueue = [];
	let command = null;

	function waitForCommand(cmd) {
		command = cmd;
		cmd.on("done", data => {
			log("ws <--", data);
			ws.send(JSON.stringify(data));
			command = null;
			processQueue();
		});
	}

	function processQueue() {
		if (command || !commandQueue.length) { return; }
		let cmd = commands.create(mpd, commandQueue.shift());
		waitForCommand(cmd);
	}

	ws.on("message", message => {
		log("ws -->", message.utf8Data);
		commandQueue.push(message.utf8Data);
		processQueue();
	});

	ws.on("close", (reasonCode, description) => {
		log(`ws ${ws.remoteAddress} disconnected`);
		mpd.end();
	});

	mpd.on("close", () => {
		log("mpd disconnected");
		ws.close();
	});

	mpd.on("error", () => {
		log("mpd connection error");
		ws.close();
	});

	waitForCommand(commands.welcome(mpd));
}

exports.logging = function(enabled) {
	log.enabled = enabled;
}

exports.ws2mpd = function(httpServer, requestValidator) {
	function ready() { log("ws2mpd attached to a http server", httpServer.address()); }
	(httpServer.listening ? ready() : httpServer.on("listening", ready));

	let wsServer = new (require("websocket").server)({
		httpServer,
		autoAcceptConnections: false
	});

	wsServer.on("request", request => {
		if (requestValidator && !requestValidator(request)) {
			log("rejecting connection from origin", request.origin);
			return request.reject();
		}
		initConnection(request);
	});
}
