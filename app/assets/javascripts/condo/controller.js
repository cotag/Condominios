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
	uploads.controller('UploadsCtrl' ['$scope', 'Condo.Api', function($scope, api) {
		
		$scope.uploads = [];
		
		$scope.addFile = function(file) {
			api.check_provider(file).then();
		}
		
	}]);
	
	
	
}));