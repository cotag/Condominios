module Condo
	
	module Errors
		class LostTheKeys < RuntimeError; end			# Authentication
		class NotYourPlace < RuntimeError; end			# Authorisation
		class MissingFurniture < RuntimeError; end		# File not found
	end
	
end