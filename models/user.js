"use strict";

require("dotenv").config();
const db = require("../db");
const bcrypt = require("bcrypt");
const { BCRYPT_WORK_FACTOR } = require("../config.js");

const {
  NotFoundError,
  BadRequestError,
  UnauthorizedError,
} = require("../expressError");

const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const client = new S3Client({ region: process.env.BUCKET_REGION });

const uuid = require("uuid");

class User {

  static async register(
    { username, password, firstName, lastName, email, zipcode, friendRadius,
      hobbies, interests }) {

    const duplicateCheck = await db.query(`
      SELECT username
      FROM users
      WHERE username = $1`, [username],
    );

    if (duplicateCheck.rows.length > 0) {
      throw new BadRequestError(`Duplicate username: ${username}`);
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_WORK_FACTOR);

    const result = await db.query(`
                INSERT INTO users
                (username,
                 password,
                 first_name,
                 last_name,
                 email,
                 zip_code,
                 friend_radius,
                 hobbies,
                 interests)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING
                    username,
                    first_name AS "firstName",
                    last_name AS "lastName",
                    email,
                    zip_code AS "zipcode",
                    friend_radius AS "friendRadius",
                    hobbies,
                    interests`, [
      username,
      hashedPassword,
      firstName,
      lastName,
      email,
      zipcode,
      friendRadius,
      hobbies,
      interests
    ],
    );

    const user = result.rows[0];

    return user;
  }

  static async login({username, password}) {

    const result = await db.query(`
        SELECT username,
               password
        FROM users
        WHERE username = $1`,[username]
    );

    const user = result.rows[0];

    if (user) {
      // compare hashed password to a new hash from password
      const isValid = await bcrypt.compare(password, user.password);
      if (isValid === true) {
        delete user.password;
        return user.username;
      }
    }

    throw new UnauthorizedError("Invalid Username/Password");
  }

  static async getAll() {
    const result = await db.query(`
        SELECT users.username,
               first_name AS "firstName",
               last_name  AS "lastName",
               email,
               zip_code AS "zipCode",
               friend_radius AS "friendRadius",
               hobbies,
               interests,
               photo_profile AS "profilePic"
        FROM users
        JOIN photos ON users.username = photos.username
        ORDER BY username`,
    );

    return result.rows;
  }

  static setProfile(file) {
    const url = this.handlePhotoData(file);

    // TODO: DB QUERY
  }

  /** Upload file to bucket. Returns image URL. */

  static async handleProfilePic(username, file) {
    let url = "https://i.pinimg.com/736x/24/1f/49/241f49ca612ef379a78fdcf7b8471ada.jpg";

    if (file) {
      const key = uuid.v4();

      const params = {
        Bucket: process.env.BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: "public-read"
      };

      const command = new PutObjectCommand(params);

      try {
        const response = await client.send(command);
        url = `https://${process.env.BUCKET_NAME}.s3.${process.env.BUCKET_REGION}.amazonaws.com/${key}`;

      } catch (err) {
        throw new BadRequestError(`failed to upload to bucket`);
      }
    }

    const result = await db.query(`
    INSERT INTO photos
    (username,
     photo_profile)
    VALUES ($1, $2)
    RETURNING
        username,
        photo_profile AS "profilePhoto"`, [
        username,
        url
        ],
    );

    const user = result.rows[0];
    return user.profilePhoto;
  };
}



module.exports = User;