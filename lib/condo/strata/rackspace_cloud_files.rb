module Condo; end
module Condo::Strata; end

#
# NOTE:: Set Account Metadata Key for Public Access before this will work - X-Account-Meta-Temp-Url-Key: <your key>
#

class Condo::Strata::RackspaceCloudFiles
	
	def initialize(options)
		@options = {
			:name => :RackspaceCloudFiles,
			:location => :na,			# dallas or chicago	- this is set at bucket creation time
			:fog => {
				:provider => 'Rackspace',
				:rackspace_username => options[:username],
				:rackspace_api_key => options[:secret_key],
				:rackspace_auth_url => options[:auth_url] || 'identity.api.rackspacecloud.com' # is US and UK is 'lon.auth.api.rackspacecloud.com'
			}
		}.merge!(options)
		
		
		raise ArgumentError, 'Rackspace Username missing' if @options[:username].nil?
		raise ArgumentError, 'Rackspace Secret Key missing' if @options[:secret_key].nil?
		
		
		@options[:location] = @options[:location].to_sym
	end
	
	
	def name
		@options[:name]
	end
	
	
	def location
		@options[:location]
	end
	
	
	#
	# Here for convenience 
	#
	def set_metatdata_key(key)
		fog_connection.request(
			:expects  => [201, 202, 204],
			:method   => 'POST',
			:headers  => {'X-Account-Meta-Temp-Url-Key' => key}
		)
	end
	
	
	#
	# Create a signed URL for accessing a private file
	#
	def get_object(options)
		options = {}.merge!(options)	# Need to deep copy here
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:verb => :get,		# Post for multi-part uploads http://docs.amazonwebservices.com/AmazonS3/latest/API/mpUploadInitiate.html
			:headers => {},
			:parameters => {}
		}.merge!(options[:object_options] || {})
		options.merge!(@options)
		
		#
		# provide the signed request
		#
		sign_request(options)[:url]
	end
	
	
	#
	# Creates a new upload request (either single shot or multi-part)
	# => Passed: bucket_name, object_key, object_options, file_size
	#
	def new_upload(options)
		options = {}.merge!(options)	# Need to deep copy here
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:verb => :put,
			:headers => {},
			:parameters => {}
		}.merge!(options[:object_options])
		options.merge!(@options)
		
		options[:object_options][:headers]['ETag'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['ETag'].nil?
		options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?
		
		
		#
		# Decide what type of request is being sent
		#
		request = {}
		if options[:file_size] > 2097152	# 2 mb (minimum chunk size)
			
			options[:object_key] = options[:object_key] + '_p1'		# Append the part number
			request[:type] = :chunked_upload
		else
			
			request[:type] = :direct_upload
		end
		
		#
		# provide the signed request
		#
		request[:signature] = sign_request(options)
		request
	end
	
	
	#
	# Returns the part we are up to
	#
	def get_parts(options)
		{
			:type => :parts,
			:current_part => options[:resumable_id]
		}
	end
	
	
	#
	# Returns the requests for uploading parts and completing a resumable upload
	#
	def set_part(options)
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:headers => {},
			:parameters => {},
			:verb => :put
		}.merge!(options[:object_options])
		options.merge!(@options)
		
		
		request = {}
		if options[:part] == 'finish'
			#
			# Send the commitment response
			#
			options[:object_options][:headers]['X-Object-Manifest'] = "#{options[:bucket_name]}/#{options[:object_key]}"
			request[:type] = :finish
		else
			#
			# Send the part upload request
			#
			options[:object_options][:headers]['Content-Md5'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['Content-Md5'].nil?
			options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?
			options[:object_key] = options[:object_key] + '_p' + options[:part]
			request[:type] = :part_upload
		end
		
		#
		# provide the signed request
		#
		request[:signature] = sign_request(options)
		request
	end
	
	
	def fog_connection
		@fog = @fog || Fog::Storage.new(@options[:fog])
		return @fog
	end
	
	
	def destroy(upload)
		connection = fog_connection
		directory = connection.directories.get(upload.bucket_name)	# it is assumed this exists - if not then the upload wouldn't have taken place
		
		if upload.resumable
			directory.files.all({'prefix' => upload.object_key}).each do |file|
				return false unless file.destroy
			end
		end
		
		file = directory.files.get(upload.object_key)	# this is the manifest when resumable
		
		return true if file.nil?
		return file.destroy
	end
	
	
	
	protected
	
	
	
	def sign_request(options)
		
		#
		# Build base URL
		#
		options[:object_options][:expires] = options[:object_options][:expires].utc.to_i
		url = "/v1/#{options[:username]}/#{CGI::escape options[:bucket_name]}/#{CGI::escape options[:object_key]}"
		
		
		
		#
		# Build a request signature
		#
		signature = "#{options[:object_options][:verb].to_s.upcase}\n#{options[:object_options][:expires]}\n#{url}"
		
		
		#
		# Encode the request signature
		#
		signature = OpenSSL::HMAC.hexdigest('sha1', @options[:secret_key], signature)
		
		
		#
		# Finish building the request
		#
		return {
			:verb => options[:object_options][:verb].to_s.upcase,
			:url => "https://storage.clouddrive.com#{url}?temp_url_sig=#{signature}&temp_url_expires=#{options[:object_options][:expires]}",
			:headers => options[:object_options][:headers]
		}
	end
	
	
end

