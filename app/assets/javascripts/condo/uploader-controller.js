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
	
	
	//
	// Adjust for mobile and desktop events
	//
	uploads.directive('coTap', function() {
		return function(scope, element, attrs) {
			if('ontouchend' in document) {		// Detect if touch events are available
				var tapping = false;
				element.on('touchstart', function() {
					tapping = true;
				});
				element.on('touchmove touchcancel', function() {
					tapping = false;
				});
				element.on('touchend', function() {
					if (tapping)
						scope.$apply(attrs['coTap']);
				});
			} else {
				element.on('click', function() {
					scope.$apply(attrs['coTap']);
				});
			}
		};
	});
	
	
	//
	// TODO:: create a directive for attaching events (including destroy)
	//
	
	
}));