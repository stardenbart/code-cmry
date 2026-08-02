import jwt from "jsonwebtoken";

// Verifies the Bearer JWT and attaches { id, username } to req.user
export function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token missing" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, process.env.JWT_SECRET || "jwt_secret_key", (err, decoded) => {
    if (err) return res.status(401).json({ message: "Invalid or expired token" });
    req.user = decoded;
    next();
  });
}
