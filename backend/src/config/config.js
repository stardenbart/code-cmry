export const DB_CONFIG = {
  host:     process.env.DB_HOST     || "localhost",
  user:     process.env.DB_USER     || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME     || "central_of_digitalization",
};

export const SERVER_CONFIG = {
  port: parseInt(process.env.PORT) || 5000,
};
