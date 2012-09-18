module Condo
	
	module Backend
		
		module Base
			
			def self.included(base)
				base.extend ClassMethods
			end
			
			module ClassMethods
				
				#
				# These methods include: check_exists, check_pending, add_entry
				#
				
				
			end
			
			#
			# The methods here include: add_resumable_reference and remove_entry
			#
			
		end
		
	end

end
