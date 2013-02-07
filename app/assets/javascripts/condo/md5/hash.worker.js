//= require condo/md5/spark-md5
//= require condo/md5/hasher


var hasher = new CondoMD5Hasher(postMessage, true);	// Accepts the callback as the parameter


// Hook-up worker input
onmessage = function (e) {
	hasher.hash(e.data);
};
