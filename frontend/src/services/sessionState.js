let verifiedToken = null;
export const verifySession = token => { verifiedToken = token; };
export const sessionVerified = () => !!verifiedToken && localStorage.getItem('token') === verifiedToken;
export const invalidateSession = () => { verifiedToken = null; };
