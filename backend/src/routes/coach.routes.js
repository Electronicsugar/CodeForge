const express = require("express");
const { authMiddleware } = require("../middlewares/auth.middleware");
const controller = require("../controllers/analysis.controller");

const router = express.Router();
router.get("/me", authMiddleware, controller.getMyCoach);

module.exports = router;
