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
				tracker = {},
				
			safeApply = function(fn) {
				var phase = scope.$root.$$phase;
				if(phase == '$apply' || phase == '$digest') {
					fn();
				} else {
					scope.$apply(fn);
				}
			},
			
			// common event handler for the mouse/pointer/touch models and their down/start, move, up/end, and cancel events
			DoEvent = function(event) {
				 
				// optimize rejecting mouse moves when mouse is up
				if (event.originalEvent.type == "mousemove" && NumberOfKeys(tracker) == 0)
					return;
				
				var theEvtObj = event.originalEvent,
					pointerList = theEvtObj.changedTouches ? theEvtObj.changedTouches : [theEvtObj];
				for (var i = 0; i < pointerList.length; ++i) {
					var pointerObj = pointerList[i],
						pointerId = (typeof pointerObj.identifier != 'undefined') ? pointerObj.identifier : (typeof pointerObj.pointerId != 'undefined') ? pointerObj.pointerId : 1;
					 
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
							safeApply(attrs['coTap']);	// Apply the click, touch, point event
						
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
			};
 
			if (window.navigator.msPointerEnabled) {
				// Microsoft pointer model
				element.on('MSPointerDown.condo MSPointerMove.condo MSPointerUp.condo MSPointerCancel.condo', DoEvent);
			} else {
				// iOS touch model & mouse model
				element.on('touchstart.condo touchmove.condo touchend.condo touchcancel.condo mousedown.condo mousemove.condo mouseup.condo', DoEvent);
				
				// mouse model with capture
				// rejecting gecko because, unlike ie, firefox does not send events to target when the mouse is outside target
				if (element[0].setCapture && !window.navigator.userAgent.match(/\bGecko\b/))
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
				delegate: attrs['coDelegate'] || element,
				drop_targets: attrs['coTargets'] || element,
				hover_class: attrs['coHoverClass'] || 'drag-hover',
				pre_check: attrs['coAccepts'] || '/./i',
				size_limit: attrs['coLimit'] || 0
			};
			
			
			if(!!attrs['coEndpoint'])
				scope.endpoint = attrs['coEndpoint'];
				
				
			scope.options = options;
			
			
			//
			// Determine how to draw the element
			//
			if(document.implementation.hasFeature("org.w3c.svg", "1.0")) {
				element.addClass('supports-svg');
			} else {
				element.addClass('no-svg');
			}
				
				
			//
			// Detect file drops
			//
			options.drop_targets = $(options.drop_targets);
			options.delegate = $(options.delegate).on('drop.condo', options.drop_targets, function(event) {
				options.drop_targets.removeClass(options.hover_class);
				
				//
				// Prevent propagation early (so any errors don't cause unwanted behaviour)
				//
				event.preventDefault();
				event.stopPropagation();
				
				scope.add(event.originalEvent.dataTransfer.files);
			}).on('dragover.condo', options.drop_targets, function(event) {
				$(this).addClass(options.hover_class);
				
				return false;
			}).on('dragleave.condo', options.drop_targets, function(event) {
				$(this).removeClass(options.hover_class);
				
				return false;
			}).
			
			
			//
			// Detect manual file uploads
			//
			on('change.condo', ':file', function(event) {
				
				scope.add($(this)[0].files);
				$(this).parent()[0].reset();
				
			});
			
			
			//
			// Clean up any event handlers
			//
			scope.$on('$destroy', function() {
				options.drop_targets.off('.condo');
				options.delegate.off('.condo');
				element.removeClass('supports-svg').removeClass('no-svg');
			});
			
			
			scope.humanReadableByteCount = function(bytes, si) {
				var unit = si ? 1000.0 : 1024.0;
				if (bytes < unit) return bytes + (si ? ' iB' : ' B');
				var exp = Math.floor(Math.log(bytes) / Math.log(unit)),
					pre = (si ? 'kMGTPE' : 'KMGTPE').charAt(exp-1) + (si ? 'iB' : 'B');
				return (bytes / Math.pow(unit, exp)).toFixed(1) + ' ' + pre;
			}
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