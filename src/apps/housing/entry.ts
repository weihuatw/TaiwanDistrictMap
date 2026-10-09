const query = location.hash.includes('?') ? location.hash.split('?')[1] : location.search.slice(1);
const path = location.hash.startsWith('#/housing') ? location.hash : '#/housing' + (query ? '?' + query : '');
location.replace(import.meta.env.BASE_URL + path);
export {};
