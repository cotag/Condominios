

var CondoMD5Hasher = (function(global) {
	
	var part_size = 1048576,	// This is the amount of the file we read into memory as we are building the hash (1mb)
		async = true;
	
	//
	// Firefox does not have FileReader in webworkers? WTF
	//	See issue #2
	//
	if (!!!global.FileReader) {
		async = false;
		global.FileReader = global.FileReaderSync;
	}
	
	//
	// Some browsers have a vendor prefix on slice
	//
	if (!!!Blob.prototype.slice) {
		Blob.prototype.slice = Blob.prototype.webkitSlice || Blob.prototype.mozSlice;
	}

	return function(callback) {
		
		
		//
		// responds with: {success: true|false, result: <Object>}
		//
		this.hash = function(blob) {
			
			var current_part,
				md5 = new global.SparkMD5(),
				reader = new global.FileReader(),
				part_number = 0,
				length = Math.ceil(blob.size / part_size),
				fail = function() {
					callback({
						success: false,
						result: 'file read failed'
					});
				},
				hashData = function(e) {
					md5.appendBinary(e.target.result);
					if(part_number * part_size >= blob.size) {
						callback({
							success: true,
							result: md5.end()
						});
					} else {
						processPart();
					}
				},
				processPart = function() {
					var endbyte = 0;
					
					part_number += 1;
					
					if (blob.size > part_size) {		// If blob bigger then part_size we will slice it up
						endbyte = part_number * part_size;
						if (endbyte > blob.size)
							endbyte = blob.size;
							
						current_part = blob.slice((part_number - 1) * part_size, endbyte);
					} else {
						current_part = blob;
					}
					
					if(async)
						reader.readAsArrayBuffer(current_part);
					else {
						setTimeout(function() {
							try {
								hashData({
									target: {
										result: reader.readAsArrayBuffer(current_part)
									}
								});
							} catch (e) {
								fail();
							}
						}, 1);
					}
						
				};
			
			
			if(async) {
				reader.onload = hashData;
				reader.onerror = fail;
				reader.onabort = fail;
			}
			
			
			processPart();
		};
	};
	
})(this);

