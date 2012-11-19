//= require condo/md5/spark-md5
//= require condo/md5/hasher


function CondoHashWorkerEmulator(callback) {
	
	// Create an API that looks like postMessage
	this.postMessage = function (data, portArray) {
		hasher.hash(data);	// Clone the data if required JSON.parse(JSON.stringify(message)); // - Don't think it is required
	}
	
	
	this.terminate = function () {
		// No special clean-up needed.
	}
	
	function messageEvtEmulator(rawMessage) {
		callback({ data: rawMessage });
	}
	
	// Create an instance of downloader.
	var hasher = new CondoMD5Hasher(messageEvtEmulator);
}
