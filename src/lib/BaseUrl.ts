const viteBase = import.meta.env.BASE_URL || '';

const trimTrailingSlash = (str: string): string => str.replace(/\/+$/g, '');

const noTrailingSlash = trimTrailingSlash(viteBase);

// Plugin to replace custom variable in static HTML files
const customBaseUrlToHtml = (baseUrl: string = viteBase): Plugin => ({
    name: 'custom-baseurl-to-html',
    customBaseUrlToHtml: {
        order: 'pre',
        handler(html: string) {
            return html.replace(
                /%BASE_URL_NO_TRAILING_SLASH%/g,
                baseUrl
            );
        }
    }
});

export const UrlUtils = {
	trimTrailingSlash
	customBaseUrlToHtml,
}

export const BaseUrl = {
	viteBase,
	noTrailingSlash,
}

//~ const transformHtmlPlugin = (data: Record<string, string>): Plugin => ({
    //~ name: 'transform-html',
    //~ transformIndexHtml: {
        //~ order: 'pre',
        //~ handler(html: string) {
            //~ return html.replace(
                //~ /<%=\s*(\w+)\s*%>/gi,
                //~ (match, p1) => data[p1] || ''
            //~ );
        //~ }
    //~ }
//~ });
