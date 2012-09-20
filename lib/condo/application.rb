module Condo
		
	class Application
		
		cattr_reader :backend
		
		#
		# The following data needs to be stored in any backend
		# => provider_name		(amazon, rackspace, google, azure etc)
		# => provider_location	(US West (Oregon) Region, Asia Pacific (Singapore) Region etc)
		# => user_id			(the identifier for the current user as a string)
		# => file_name			(the original upload file name)
		# => file_size			(the file size as indicated by the client)
		# => file_id			(some sort of identifying hash provided by the client)
		# => bucket_name		(the name of the users bucket)
		# => object_key			(the path to the object in the bucket)
		# => object_options		(custom options that were applied to this object - public/private etc)
		# => resumable_id		(the id of the chunked upload)
		# => custom_params		(application specific data - needs to be serialised and de-serialised)
		# => date_created		(the date the upload was started)
		#
		# => Each backend should have an ID that uniquely identifies an entry - id or upload_id
		#
		
		#
		# Backends should inherit this class, set themselves as the backend and define the following:
		#
		# Class Methods:
		# => check_exists		({user_id, upload_id})							returns nil or an entry where all fields match
		# 		check_exists	({user_id, file_name, file_size, file_id})		so same logic for this
		# => add_entry ({user_id, file_name, file_size, file_id, provider_name, provider_location, bucket_name, object_key})
		#
					
		#
		# Instance Methods:
		# => update_entry ({upload_id, resumable_id})
		# => remove_entry (upload_id)
		#
		
		
		protected
		
		
		self.backend=(parent)
			@@backend = parent
		end
	end

end
