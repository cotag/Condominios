module Condo; end
module Condo::Strata; end


class Fog::Storage::Google::Real
	def condo_request(*args)
		request(*args)
	end
end


class Condo::Strata::GoogleCloudStorage
	
	def initialize(options)
		@options = {
			:name => :GoogleCloudStorage,
			:location => :na,				# US or Europe, set at bucket creation time
			:fog => {
				:provider => 'Google',
				:google_storage_access_key_id => options[:access_id],
				:google_storage_secret_access_key => options[:secret_key]
			},
			:api => 1
		}.merge!(options)
		
		
		raise ArgumentError, 'Google Access ID missing' if @options[:access_id].nil?
		raise ArgumentError, 'Google Secret Key missing' if @options[:secret_key].nil?
		
		if @options[:api] == 2
			@options[:secret_key] = OpenSSL::PKey::RSA.new(@options[:secret_key])
		end
		
		@options[:location] = @options[:location].to_sym
	end
	
	
	#
	# Enable CORS on a bucket for a domain
	#
	def enable_cors(bucket, origin = '*')
		data =
<<-DATA
<?xml version="1.0" encoding="UTF-8"?>
<CorsConfig>
  <Cors>
    <Origins>
      <Origin>#{origin}</Origin>
    </Origins>
    <Methods>
      <Method>GET</Method>
      <Method>HEAD</Method>
      <Method>POST</Method>
      <Method>PUT</Method>
    </Methods>
    <ResponseHeaders>
      <ResponseHeader>origin</ResponseHeader>
      <ResponseHeader>content-md5</ResponseHeader>
      <ResponseHeader>authorization</ResponseHeader>
      <ResponseHeader>x-goog-date</ResponseHeader>
      <ResponseHeader>x-goog-acl</ResponseHeader>
      <ResponseHeader>content-type</ResponseHeader>
      <ResponseHeader>accept</ResponseHeader>
      <ResponseHeader>x-goog-api-version</ResponseHeader>
      <ResponseHeader>x-goog-resumable</ResponseHeader>
    </ResponseHeaders>
    <MaxAgeSec>1800</MaxAgeSec>
  </Cors>
</CorsConfig>
DATA
		
		fog_connection.condo_request(
			:expects  => 200,
			:body     => data,
			:method   => 'PUT',
			:headers  => {},
			:host       => "#{bucket}.storage.googleapis.com",
			:idempotent => true,
			:path     => '?cors'	# There is an issue with Fog where this isn't included as a canonical_resource
		)
	end
	
	
	def name
		@options[:name]
	end
	
	
	def location
		@options[:location]
	end
	
	
	#
	# Create a signed URL for accessing a private file
	#
	def get_object(options)
		options = {}.merge!(options)	# Need to deep copy here
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:verb => :get,
			:headers => {},
			:parameters => {},
			:protocol => :https
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
			:permissions => :private,
			:expires => 5.minutes.from_now,
			:verb => :put,				# This will be a post for resumable uploads
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge!(options[:object_options] || {})
		options.merge!(@options)
		
		
		#
		# Set the access control headers
		#
		options[:object_options][:headers]['x-goog-api-version'] = @options[:api]
		
		if options[:object_options][:headers]['x-goog-acl'].nil?
			options[:object_options][:headers]['x-goog-acl'] = case options[:object_options][:permissions]
			when :public
				:'public-read'
			else
				:private
			end
		end
		
		options[:object_options][:headers]['Content-Md5'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['Content-Md5'].nil?
		options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?
				
		
		#
		# Decide what type of request is being sent
		# => Currently google only supports direct uploads (no CORS resumables yet!)
		#
		return {
			:signature => sign_request(options),
			:type => :direct_upload
		}
		
		#
		# This is what we'll return when resumables work with CORS
		#
		if options[:file_size] > 2.megabytes
			# Resumables may not support the md5 header at this time - have to compare ETag and fail on the client side
			options[:object_options][:verb] = :post
			options[:object_options][:headers]['x-goog-resumable'] = 'start'
			return {
				:signature => sign_request(options),
				:type => :chunked_upload				# triggers resumable
			}
		end
	end
	
	
	#
	# Creates a request for the byte we were up to
	# => doesn't work with CORS yet
	#
	def get_parts(options)
		options[:object_options] = {
			:expires => 5.minutes.from_now,
			:verb => :put,
			:headers => {},
			:parameters => {},
			:protocol => :https
		}.merge!(options[:object_options])
		options.merge!(@options)
		
		#
		# Set the upload and request the range of bytes we are after
		#
		options[:object_options][:parameters]['upload_id'] = options[:resumable_id]
		## This can be set on the client side as it is not part of the signed request
		#options[:object_options][:headers]['Content-Range'] = "bytes */#{options[:file_size]}"
		
		#
		# provide the signed request
		#
		{
			:type => :parts,
			:signature => sign_request(options)
		}
	end
	
	
	#
	# Returns the requests for uploading parts and completing a resumable upload
	#
	def set_part(options)
		resp = get_parts(options)
		resp[:type] = :part_upload
		return resp
	end
	
	
	def fog_connection
		@fog = @fog || Fog::Storage.new(@options[:fog])
		return @fog
	end
	
	
	def destroy(upload)
		connection = fog_connection
		directory = connection.directories.get(upload.bucket_name)	# it is assumed this exists - if not then the upload wouldn't have taken place		
		file = directory.files.get(upload.object_key)				# NOTE:: I only assume this works with resumables... should look into it
		
		return true if file.nil?
		return file.destroy
	end
	
	
	
	protected
	
	
	
	def sign_request(options)
		
		#
		# Build base URL
		#
		verb = options[:object_options][:verb].to_s.upcase.to_sym
		options[:object_options][:expires] = options[:object_options][:expires].utc.to_i
		
		url = "/#{options[:object_key]}"
		
		
		#
		# Add signed request params
		#
		other_params = ''
		signed_params = '?'
		(options[:object_options][:parameters] || {}).each do |key, value|
            if ['acl', 'cors', 'location', 'logging', 'requestPayment', 'torrent', 'versions', 'versioning'].include?(key)
				signed_params << "#{key}&"
			else
				other_params << (value.empty? ? "#{key}&" : "#{key}=#{value}&")
            end
		end
		signed_params.chop!
		
		url << signed_params
		
		
		#
		# Build a request signature
		#
		signature = "#{verb}\n#{options[:file_id]}\n#{options[:object_options][:headers]['Content-Type']}\n#{options[:object_options][:expires]}\n"
		if verb != :GET
			options[:object_options][:headers]['x-goog-date'] ||= Time.now.utc.httpdate
		
			google_headers, canonical_google_headers = {}, ''			# Copied from https://github.com/fog/fog/blob/master/lib/fog/google/storage.rb
			for key, value in options[:object_options][:headers]
				if key[0..6] == 'x-goog-'
					google_headers[key] = value
				end
			end
			
			google_headers = google_headers.sort {|x, y| x[0] <=> y[0]}
			for key, value in google_headers
				signature << "#{key}:#{value}\n"
			end
		end
		
		signature << "/#{options[:bucket_name]}#{url}"
		
		
		#
		# Encode the request signature
		#
		if @options[:api] == 1
			signature = Base64.encode64(OpenSSL::HMAC.digest(OpenSSL::Digest::Digest.new('sha1'), @options[:secret_key], signature)).gsub("\n","")
			options[:object_options][:headers]['Authorization'] = "GOOG1 #{@options[:access_id]}:#{signature}"
		else
			signature = Base64.encode64(@options[:secret_key].sign(OpenSSL::Digest::SHA256.new, signature)).gsub("\n","")
		end
		
		
		url += signed_params.present? ? '&' : '?'
		url = "#{options[:object_options][:protocol]}://#{options[:bucket_name]}.storage.googleapis.com#{url}#{other_params}GoogleAccessId=#{@options[:access_id]}&Expires=#{options[:object_options][:expires]}&Signature=#{CGI::escape(signature)}"
		
		
		#
		# Finish building the request
		#
		return {
			:verb => options[:object_options][:verb].to_s.upcase,
			:url => url,
			:headers => options[:object_options][:headers]
		}
	end
	
	
end

