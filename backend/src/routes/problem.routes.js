const express = require("express");

const {authMiddleware, adminMiddleware} = require("../middlewares/auth.middleware");

const problemController = require("../controllers/problem.controller");

const router = express.Router();

// Create Problems by admin
router.post("/", authMiddleware, adminMiddleware, problemController.createProblem);

// Get all + filters + pagination
router.get("/", problemController.getProblems);

// Languages the judge supports (drives the editor's language picker)
router.get("/languages", problemController.getLanguages);

// Problem-specific submissions
router.get("/:problemId/submissions", authMiddleware, problemController.getProblemSubmissions);

// Get single problem
router.get("/:id", problemController.getProblemById);

// Update problem by admin
router.put("/:id", authMiddleware, adminMiddleware, problemController.updateProblem);

// Delete problem by admin 
router.delete("/:id", authMiddleware, adminMiddleware, problemController.deleteProblem);

module.exports = router;