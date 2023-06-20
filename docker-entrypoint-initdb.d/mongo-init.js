db = db.getSiblingDB("admin");
db.createUser({
  user:  process.env.MONGO_USERNAME,
  pwd:   process.env.MONGO_PASSWORD,
  roles: [
    { role: "readWrite", db: process.env.MONGO_DB, },
    { role: "readWrite", db: process.env.MONGO_AUTH_DB, }
  ],
});