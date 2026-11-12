const jwt = require("jsonwebtoken");
const { redisClient } = require('../config/redis');

const authMiddleware = async (req, res, next) =>{
    try {
        const authHeader = req.headers.authorization;
        if(!authHeader){
            return res.status(401).json({
                success: false,
                message: "Authorization header missing"
            });
        }
        if (!authHeader.startsWith("Bearer ")) {
            return res.status(401).json({
                success: false,
                message: "Invalid Token Format"
            });
        }
        const token = authHeader.split(" ")[1];

        // Check if token has been revoked / blacklisted in Redis
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (!redisClient.isReady) return res.status(503).json({success:false,message:'Session verification temporarily unavailable'});
        const isBlacklisted = await redisClient.get(`blacklist:${token}`);
        if (isBlacklisted) {
            return res.status(401).json({
                success: false,
                message: "Token has been revoked. Please login again."
            });
        }

        req.token = token;
        req.user = decoded;
        next();
    } catch (error) {
        const invalid = ['JsonWebTokenError','TokenExpiredError','NotBeforeError'].includes(error.name);
        return res.status(invalid ? 401 : 503).json({
            success: false,
            message: invalid ? 'Invalid or Expired Token' : 'Session verification temporarily unavailable'
        });
    }
}

const adminMiddleware = (req, res, next) => {
    if(!req.user) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized"
        })
    }
    if (req.user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Admin access required"
        });
    }
    next();
}

module.exports = {authMiddleware,adminMiddleware};
