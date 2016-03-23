# encoding: utf-8

require 'uri'

module Condo; end
module Condo::Strata; end

#
# NOTE:: Set Account Metadata Key for Public Access before this will work - X-Account-Meta-Temp-Url-Key: <your key>
#

class Condo::Strata::OpenStackSwift
    MIN_CHUNK_SIZE = 2.megabytes

    def initialize(options)
        @options = {
            name: :OpenStackSwift,
            location: :dfw,
            fog: {
                provider: 'OpenStack',
                openstack_username: options[:username],
                openstack_api_key: options[:secret_key],
                openstack_temp_url_key: options[:temp_url_key],
                openstack_auth_url: options[:auth_url] || 'https://identity.api.rackspacecloud.com/v2.0/tokens' # is US and UK is 'lon.auth.api.rackspacecloud.com'
            }
        }.merge!(options)

        case @options[:location]
            when :dfw, :dallas, :DFW
                @options[:location] = 'https://storage101.dfw1.clouddrive.com'
                @options[:fog][:openstack_region] = 'DFW'
            when :ord, :chicago, :ORD
                @options[:location] = 'https://storage101.ord1.clouddrive.com'
                @options[:fog][:openstack_region] = 'ORD'
            when :iad, :virginia, :IAD
                @options[:location] = 'https://storage101.iad1.clouddrive.com'
                @options[:fog][:openstack_region] = 'IAD'
            when :lon, :london, :LON
                @options[:location] = 'https://storage101.lon1.clouddrive.com'
                @options[:fog][:openstack_region] = 'LON'
            when :syd, :sydney, :SYD
                @options[:location] = 'https://storage101.syd1.clouddrive.com'
                @options[:fog][:openstack_region] = 'SYD'
            when :hkg, :hong_kong, :HKG
                @options[:location] = 'https://storage101.hkg1.clouddrive.com'
                @options[:fog][:openstack_region] = 'HKG'
            else
                @options[:fog][:openstack_management_url] = "#{@options[:location]}/v1/#{@options[:storage_url]}"
        end


        raise ArgumentError, 'Swift Storage URL missing' if @options[:storage_url].nil?
        raise ArgumentError, 'Swift Temp URL Key missing' if @options[:temp_url_key].nil?


        @options[:location] = @options[:location].to_sym
    end


    def name
        @options[:name]
    end


    def location
        @options[:location]
    end

    def scheme
        @options[:scheme] || URI.parse(@options[:fog][:openstack_auth_url]).scheme
    end


    # Here for convenience 
    def set_metadata_key(key)
        fog_connection.request(
            expects: [201, 202, 204],
            method:  'POST',
            headers: {'X-Account-Meta-Temp-Url-Key' => key}
        )
    end


    def allow_cors(domains = 'http://localhost:9000', options_age = 10, headers = 'etag, content-type, accept, origin, x-requested-with')
        fog_connection.request(
            expects: [201, 202, 204],
            method:  'POST',
            headers: {
                'X-Container-Meta-Access-Control-Allow-Origin' => domains,
                'X-Container-Meta-Access-Control-Max-Age' => options_age,
                'X-Container-Meta-Access-Control-Allow-Headers' => headers
            }
        )
    end


    # Create a signed URL for accessing a private file
    def get_object(options)
        options = {}.merge!(options)    # Need to deep copy here
        options[:object_options] = {
            expires: 5.minutes.from_now,
            verb: :get,
            headers: {},
            parameters: {}
        }.merge!(options[:object_options] || {})
        options.merge!(@options)

        # provide the signed request
        sign_request(options)[:url]
    end


    # Creates a new upload request (either single shot or multi-part)
    # => Passed: bucket_name, object_key, object_options, file_size
    def new_upload(options)
        options = {}.merge!(options)    # Need to deep copy here
        options[:object_options] = {
            expires: 5.minutes.from_now,
            verb: :put,
            headers: {},
            parameters: {}
        }.merge!(options[:object_options])
        options.merge!(@options)

        options[:object_options][:headers]['ETag'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['ETag'].nil?
        options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream' if options[:object_options][:headers]['Content-Type'].nil?


        # Decide what type of request is being sent
        request = {}
        # 2 mb (minimum chunk size)
        if options[:file_size] > MIN_CHUNK_SIZE

            options[:object_key] = options[:object_key] + gen_part_ext(options[:file_size], 1)        # Append the part number
            request[:type] = :chunked_upload
        else

            request[:type] = :direct_upload
        end

        # provide the signed request
        request[:signature] = sign_request(options)
        request
    end


    # Returns the part we are up to
    def get_parts(options)
        {
            type: :parts,
            # NOTE:: This is legacy V1 - before parallel uploads
            current_part: options[:resumable_id]
        }
    end


    # Returns the requests for uploading parts and completing a resumable upload
    def set_part(options)
        options[:object_options] = {
            expires: 5.minutes.from_now,
            headers: {},
            parameters: {},
            verb: :put
        }.merge!(options[:object_options])
        options.merge!(@options)


        request = {}
        if options[:part] == 'finish'
            # Dynamic large object now have to be created on the server...
            # Static Large Objects could be created client side.
            if @options[:use_static_large_objects]
                options[:object_options][:headers]['ETag'] = options[:file_id] if options[:file_id].present?
                options[:object_options][:headers]['Content-Type'] = 'text/plain'
                options[:object_key] = CGI::escape(options[:object_key])
                request[:signature] = sign_request(options, 'multipart-manifest=put&')
            else
                key = CGI::escape options[:object_key]

                # Send the commitment request
                fog_connection.request(
                    expects: [200, 201],
                    method:  'PUT',
                    headers: {
                        'X-Object-Manifest' => "#{CGI::escape options[:bucket_name]}/#{key}/p",
                        'Content-Type' => options[:object_options][:headers]['Content-Type'] || 'binary/octet-stream'
                    },
                    path: "#{CGI::escape options[:bucket_name]}/#{key}"
                )

                return {}
            end
        else
            # Send the part upload request
            options[:object_options][:headers]['ETag'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['ETag'].nil?
            options[:object_options][:headers]['Content-Type'] = 'binary/octet-stream'
            object_key = CGI::escape(options[:object_key]) + gen_part_ext(options[:file_size], options[:part])
            options[:object_key] = object_key
            request[:type] = :part_upload

            # Required for static large objects
            request[:path] = "#{CGI::escape options[:bucket_name]}/#{object_key}"
            request[:signature] = sign_request(options)
        end

        # provide the signed request
        request
    end


    def fog_connection
        @fog = @fog || Fog::Storage.new(@options[:fog])
        return @fog
    end


    def destroy(upload)
        connection = fog_connection
        directory = connection.directories.get(upload.bucket_name)    # it is assumed this exists - if not then the upload wouldn't have taken place

        if upload.resumable
            begin
                directory.files.all({'prefix' => upload.object_key}).each do |file|
                    begin
                        return false unless file.destroy
                    rescue ::Fog::Storage::OpenStack::NotFound => e
                    end
                end
            rescue ::Fog::Storage::OpenStack::NotFound => e
            end
        end

        file = directory.files.get(upload.object_key)    # this is the manifest when resumable

        return true if file.nil?
        return file.destroy
    end


    SEGMENT_LIMIT = 5.gigabyte - 1
    BUFFER_SIZE = 1.megabyte

    def filesize_limit
        SEGMENT_LIMIT
    end

    def large_upload(bucket, filename, file, mime = nil)
        service = fog_connection
        segment = 0

        until file.eof?
            segment += 1
            offset = 0

            # upload segment to cloud files
            segment_suffix = segment.to_s.rjust(10, '0')
            service.put_object(bucket, "#{filename}/#{segment_suffix}", nil) do
                if offset <= SEGMENT_LIMIT - BUFFER_SIZE
                    buf = file.read(BUFFER_SIZE).to_s
                    offset += buf.size
                    buf
                else
                    ''
                end
            end
        end

        # write manifest file
        service.put_object_manifest(bucket, filename, {
            'X-Object-Manifest' => "#{bucket}/#{filename}/",
            'Content-Type' => mime || 'binary/octet-stream'
        })
    end



    protected



    def sign_request(options, param = nil)
        # Build base URL
        options[:object_options][:expires] = options[:object_options][:expires].utc.to_i
        url = "/v1/#{options[:storage_url]}/#{CGI::escape options[:bucket_name]}/#{options[:object_key]}"

        # Build a request signature
        signature = "#{options[:object_options][:verb].to_s.upcase}\n#{options[:object_options][:expires]}\n#{url}"

        # Encode the request signature
        signature = OpenSSL::HMAC.hexdigest('sha1', @options[:temp_url_key], signature)

        # Finish building the request
        return {
            verb: options[:object_options][:verb].to_s.upcase,
            url: "#{@options[:location]}#{url}?#{param}temp_url_sig=#{signature}&temp_url_expires=#{options[:object_options][:expires]}",
            headers: options[:object_options][:headers]
        }
    end


    def gen_part_ext(fileSize, partNumber)
        rval = (fileSize.to_f / MIN_CHUNK_SIZE).ceil.to_s.length
        partPad = partNumber.to_s.rjust(rval, '0')
        "/p#{partPad}"
    end
end

