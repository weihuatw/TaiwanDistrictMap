const query = location.hash.includes('?') ? location.hash.split('?')[1] : location.search.slice(1);
const path = location.hash.startsWith('#/school') ? location.hash : '#/school' + (query ? '?' + query : '');
location.replace(import.meta.env.BASE_URL + path);
export {};
