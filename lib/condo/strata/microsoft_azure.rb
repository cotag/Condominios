# encoding: utf-8
# Good reference: http://gauravmantri.com/2013/02/16/uploading-large-files-in-windows-azure-blob-storage-using-shared-access-signature-html-and-javascript/

require 'azure' # Tested against 0.7.1
require 'azure/blob/auth/shared_access_signature'

require 'uri'


module Condo; end
module Condo::Strata; end


class Condo::Strata::MicrosoftAzure
    def initialize(options)
        @options = {
            :name => :MicrosoftAzure
        }.merge!(options)

        raise ArgumentError, 'Azure Account Name missing' if @options[:account_name].nil?
        raise ArgumentError, 'Azure Access Key missing' if @options[:access_key].nil?
        
        @options[:blob_host] = "https://#{@options[:account_name]}.blob.core.windows.net" if @options[:blob_host].nil?

        @options[:location] = @options[:blob_host].to_sym
    end


    def name
        @options[:name]
    end

    def location
        @options[:location]
    end

    def enable_cors(origin = 'http://localhost:9000')
        origins = origin.class == Array ? origin : [origin]
        blobs = azure_connection

        p = blobs.get_service_properties
        p.cors = Azure::Service::Cors.new do |cors|
            cors.cors_rules = []
            cors.cors_rules.push(Azure::Service::CorsRule.new { |cors_rule|
                cors_rule.allowed_origins = origins
                cors_rule.allowed_methods = ["GET", "HEAD", "PUT", "POST", "OPTIONS"]
                cors_rule.max_age_in_seconds = 60
                cors_rule.exposed_headers = ["x-ms-*", "etag", "content-type", "content-md5"]
                cors_rule.allowed_headers = ["x-ms-blob-type", "x-ms-version", "content-md5", "content-type"]
            })
        end

        blobs.set_service_properties(p)
    end


    # Create a signed URL for accessing a private file
    def get_object(options)
        options = {}.merge!(options)    # Need to deep copy here
        options[:object_options] = {
            verb: :get,
            headers: {},
            permission: 'r',
            expires: 5.minutes.from_now
        }.merge!(options[:object_options] || {})
        options.merge!(@options)

        sign_request(options)[:url]
    end


    # Creates a new upload request (either single shot or multi-part)
    # => Passed: bucket_name, object_key, object_options, file_size
    def new_upload(options)
        options = build_request(options)
        options[:object_options][:headers]['x-ms-blob-type'] = 'BlockBlob'

        # Decide what type of request is being sent
        if options[:file_size] > 2.megabytes
            return {
                signature: sign_request(options),
                type: :chunked_upload
            }
        else
            options[:object_options][:headers]['Content-Md5'] = options[:file_id] if options[:file_id].present? && options[:object_options][:headers]['Content-Md5'].nil?
            return {
                signature: sign_request(options),
                type: :direct_upload
            }
        end
    end


    # No signing required for this request in Azure
    def get_parts(options)
        {
            type: :parts,
            current_part: options[:resumable_id]
        }
    end


    # Returns the requests for uploading parts and completing a resumable upload
    def set_part(options)
        options = build_request(options)

        if options[:part] == 'finish'
            options[:object_options][:headers]['Content-Type'] = 'application/xml; charset=UTF-8'

            return {
                signature: sign_request(options),
                type: :finish
            }
        else
            options = build_request(options)
            options[:object_options][:headers]['x-ms-blob-type'] = 'BlockBlob'
            # MaxID for a part is 100_000, hence rjust 6
            options[:partId] = Base64.encode64(options[:part].to_s.rjust(6, '0')).gsub("\n", '')

            return {
                signature: sign_request(options),
                type: :part_upload
            }
        end
    end


    def azure_connection
        options = {
            storage_account_name: @options[:account_name],
            storage_access_key: @options[:access_key]
        }
        options[:storage_blob_host] = @options[:location].to_s if @options[:location]

        client = Azure.client(options)
        client.blobs
    end


    def destroy(upload)
        blobs = azure_connection
        blobs.delete_blob(upload.bucket_name, upload.object_key)
    end

    BUFFER_SIZE = 2.megabyte

    # Always use the large upload function
    def filesize_limit
        0
    end

    Store = ::Struct.new(:public_url)

    def large_upload(bucket, filename, file, mime = nil)
        service = azure_connection
        segment = 0
        offset = 0

        # Create the ref
        service.create_block_blob(bucket, filename, nil, {content_type: mime, blob_content_type: mime})
        parts = []

        # Upload the parts
        until file.eof?
            segment += 1

            # upload segment to cloud files
            segment_suffix = segment.to_s.rjust(10, '0')
            segment_name = "#{filename}_#{segment_suffix}"
            parts << [segment_name]

            buf = file.read(BUFFER_SIZE).to_s

            if buf && !buf.empty?
                service.create_blob_block(bucket, filename, segment_name, buf)
            end
        end

        # Commit the blob
        service.commit_blob_blocks(bucket, filename, parts, {blob_content_type: mime})

        Store.new("#{@options[:blob_host]}/#{bucket}/#{filename}")
    end


    protected



    def build_request(options)
        options = {}.merge!(options)    # Need to deep copy here
        options[:object_options] = {
            verb: :put,
            headers: {},
            permission: 'w',
            expires: 5.minutes.from_now
        }.merge!(options[:object_options] || {})
        options.merge!(@options)
        options
    end

    def sign_request(options)
        signer = ::Azure::Blob::Auth::SharedAccessSignature.new(@options[:account_name], @options[:access_key])
        url = URI "#{@options[:blob_host]}/#{options[:bucket_name]}/#{options[:object_key]}"
        url = signer.signed_uri(url, {
            permissions: options[:object_options][:permission],
            expiry: options[:object_options][:expires].utc.iso8601,
            resource: 'b'
        })

        # Adjust the request for chunked uploads
        if options[:partId]
            url.query += "&comp=block&blockid=#{options[:partId]}"
        elsif options[:part] == 'finish'
            url.query += '&comp=blocklist'
        end

        # Finish building the request
        return {
            verb: options[:object_options][:verb].to_s.upcase,
            url: url.to_s,
            headers: options[:object_options][:headers]
        }
    end
end

