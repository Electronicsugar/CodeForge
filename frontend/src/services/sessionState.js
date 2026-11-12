let verifiedToken = null, verifiedUser = null;
export const verifySession = (token,userId) => { verifiedToken = token; verifiedUser=userId; };
export const sessionUserId = () => sessionVerified() ? verifiedUser : null;
export const sessionVerified = () => !!verifiedToken && localStorage.getItem('token') === verifiedToken;
export const invalidateSession = () => { verifiedToken = null; verifiedUser=null; };
