/**
*	CoTag Condo
*	Direct to cloud resumable uploads
*	
*   Copyright (c) 2012 CoTag Media.
*	
*	@author 	Stephen von Takach <steve@cotag.me>
* 	@copyright  2012 cotag.me
* 
* 	
* 	References:
* 		* https://github.com/umdjs/umd
* 		* https://github.com/addyosmani/jquery-plugin-patterns
*		* 
*
**/

(function (factory) {
	if (typeof define === 'function' && define.amd) {
		// AMD
		define(['jquery', 'condo_uploader'], factory);
	} else {
		// Browser globals
		factory(jQuery, window.CondoUploader);
	}
}(function ($, uploads, undefined) {
	'use strict';
	


	//
	// Create a controller for managing the upload states
	//
	uploads.controller('UploadsCtrl', ['$scope', 'Condo.Api', function($scope, api) {
		
		$scope.uploads = [];
		$scope.endpoint = '/uploads';
		
		$scope.add = function(files) {
			for (var i = 0, length = files.length; i < length; i += 1) {
				api.check_provider($scope.endpoint, files[i]).then(function(upload){
					$scope.uploads.push(upload);
				}, function(failure){
					alert('Upload could not be started: ' + failure);
				});
			}
		};

		$scope.remove = function(upload) {
			//
			// TODO:: find the upload and remove it
			//
		};
		
		$scope.playpause = function(upload) {
			if (upload.state == 3)					// Uploading
				upload.pause();
			else
				upload.start();
		};
		
	}]);
	
	
	
}));