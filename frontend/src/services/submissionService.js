import api from "./api";
import {submitReliably} from './submissionRecovery';

export const createSubmission = submitReliably;

export const runCode = async ({ problem, language, code, roomId }) => {
  const response = await api.post("/submissions/run", { problem, language, code, ...(roomId?{roomId}:{}) });
  return response.data;
};

export const getMySubmissions = async (params) => {
  const response = await api.get("/submissions/my", { params });
  return response.data;
};

export const getMyStats = async () => {
  const response = await api.get("/submissions/my/stats");
  return response.data;
};

export const getSubmissionById = async (id) => {
  const response = await api.get(`/submissions/${id}`);
  return response.data;
};
