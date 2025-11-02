// typeof check is safer to check if undefined
// during local development this variable won't exist
if (typeof PROCESS_ENV === 'undefined') {
    window.CLOUDFLARE_COMMIT_SHA = window.location.hostname
    window.CLOUDFLARE_BRANCH = 'dev'
}
else {
    // grab a couple environment variables from Clourflare build process
    // Vite actually does the injection, so look at vite.config.js with the "define" block
    window.CLOUDFLARE_COMMIT_SHA = PROCESS_ENV.WORKERS_CI_COMMIT_SHA
    window.CLOUDFLARE_BRANCH = PROCESS_ENV.WORKERS_CI_BRANCH || 'unknown'
}
