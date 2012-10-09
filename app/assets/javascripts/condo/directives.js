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
*		* http://ie.microsoft.com/testdrive/ieblog/2011/oct/PointerDraw.js.source.html
*		* http://docs.angularjs.org/guide/directive
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
	// Allow for both mobile and desktop events or both
	//	Overkill?
	//
	uploads.directive('coTap', function() {
		
		
		//
		// Opera doesn't have Object.keys so we use this wrapper
		//
		var NumberOfKeys = function(theObject) {
			if (Object.keys)
				return Object.keys(theObject).length;
			
			var n = 0;
			for (var key in theObject)
				++n;
			
			return n;
		};
		
		return function(scope, element, attrs) {
			var useSetReleaseCapture = false,
				tracker = {};
			
			// common event handler for the mouse/pointer/touch models and their down/start, move, up/end, and cancel events
			function DoEvent(event) {
				var theEvtObj = event.originalEvent;
				 
				// optimize rejecting mouse moves when mouse is up
				if (theEvtObj.type == "mousemove" && NumberOfKeys(tracker) == 0)
					return;
				 
				var pointerList = theEvtObj.changedTouches ? theEvtObj.changedTouches : [theEvtObj];
				for (var i = 0; i < pointerList.length; ++i) {
					var pointerObj = pointerList[i];
					var pointerId = (typeof pointerObj.identifier != 'undefined') ? pointerObj.identifier : (typeof pointerObj.pointerId != 'undefined') ? pointerObj.pointerId : 1;
					 
					if (theEvtObj.type.match(/(start|down)$/i)) {
						// clause for processing MSPointerDown, touchstart, and mousedown
						
						//
						// Track the element the event started on and if we should execute the attached action
						//
						tracker[pointerId] = {element: this, execute: true};
						
						//
						// in the Microsoft pointer model, set the capture for this pointer
						// in the mouse model, set the capture or add a document-level event handlers if this is our first down point
						// nothing is required for the iOS touch model because capture is implied on touchstart
						//
						if (this.msSetPointerCapture)
							this.msSetPointerCapture(pointerId);
						else if (theEvtObj.type == "mousedown" && NumberOfKeys(tracker) == 1) {
							if (useSetReleaseCapture)
								this.setCapture(true);
							else {
								$(document).on('mousemove mouseup', DoEvent);
							}
						}
						
						
					} else if (theEvtObj.type.match(/move$/i)) {
						// clause handles mousemove, MSPointerMove, and touchmove
						
						//
						// Mouse move means we are not tapping
						//
						if(tracker[pointerId])
							tracker[pointerId].execute = false;
						
						
					} else if (tracker[pointerId] && theEvtObj.type.match(/(up|end|cancel)$/i)) {
						// clause handles up/end/cancel
						var target = tracker[pointerId].element;
						 
						if (!theEvtObj.type.match(/cancel$/i) && tracker[pointerId].execute === true)
							scope.$apply(attrs['coTap']);	// Apply the click, touch, point event
						
						delete tracker[pointerId];
						
						//
						// in the Microsoft pointer model, release the capture for this pointer
						// in the mouse model, release the capture or remove document-level event handlers if there are no down points
						// nothing is required for the iOS touch model because capture is implied on touchstart
						//
						if (target.msReleasePointerCapture)
							target.msReleasePointerCapture(pointerId);
						else if (theEvtObj.type == "mouseup" && NumberOfKeys(tracker) == 0) {
							if (useSetReleaseCapture)
								target.releaseCapture();
							else {
								$(document).off('mousemove mouseup', DoEvent);
							}
						}
					}
				}
			}
 
			if (window.navigator.msPointerEnabled) {
				// Microsoft pointer model
				element.on('MSPointerDown.condo MSPointerMove.condo MSPointerUp.condo MSPointerCancel.condo', DoEvent);
			} else {
				// iOS touch model & mouse model
				element.on('touchstart.condo touchmove.condo touchend.condo touchcancel.condo mousedown.condo mousemove.condo mouseup.condo', DoEvent);
				
				// mouse model with capture
				// rejecting gecko because, unlike ie, firefox does not send events to target when the mouse is outside target
				if (element[0].setCapture && !window.navigator.userAgent.match(/\bGecko\b/)) {
					useSetReleaseCapture = true;
			}
			
			
			//
			// Clean up any event handlers
			//
			scope.$on('$destroy', function() {
				$(document).off('mousemove mouseup', DoEvent);
				element.off('.condo');
			});
		};
	});
	
	//
	// create a directive for attaching the input events
	//
	uploads.directive('coUploads', function() {
		return function(scope, element, attrs) {				
			var options = {
				delegate: $(attrs['coDelegate']) || element,
				drop_targets: $(attrs['coTargets']) || element,
				pre_check: $(attrs['coAccepts']) || /.$/i,
				size_limit: $(attrs['coLimit']) || 0
			};
			
			if(!!attrs['coEndpoint'])
				scope.endpoint = attrs['coEndpoint'];

			//
			// TODO:: attach events
			//
		}
	});
	
	
	//
	// The individual upload events
	//	Triggers the pause, resume, abort functions
	//
	uploads.directive('coUpload', function() {
		return function(scope, element, attrs) {
			
		};
	});
	
}));