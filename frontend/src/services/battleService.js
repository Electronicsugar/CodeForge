import api from "./api";

export const getBattleById = (battleId) => {
  return api.get(`/battles/${battleId}`);
};

export const getBattleAnalysis = (battleId) => {
  return api.get(`/battles/${battleId}/analysis`);
};
