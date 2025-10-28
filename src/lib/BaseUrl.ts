const viteBase = import.meta.env.BASE_URL;

const trimTrailingSlash = (str: string): string => str.replace(/\/+$/g, '');

const noTrailingSlash = trimTrailingSlash(viteBase);

export const BaseUrl = {
	viteBase,
	noTrailingSlash,
}

// Plugin to replace custom variable in static HTML files
export const customBaseUrlToHtml = () => ({
    name: 'custom-base-url-to-html',
    transformIndexHtml: {
        //order: 'pre',
        handler(html: string) {
            return html.replace(
                /%BASE_URL_NO_TRAILING_SLASH%/g,
                noTrailingSlash
            );
        }
    }
});

