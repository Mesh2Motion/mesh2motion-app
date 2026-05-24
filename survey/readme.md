# Survey original setup instructions

I am using Cloudflare for this since that is just where I am doing things. If something else is used, this process won't work. I am mostly writing this when I forget what I did, or need to set it up later on if I have to change platforms.

1. Create a new database on your Cloudflare account
2. Get the UUID of the database usin the npx command in command prompt: npx wrangler d1 list
3. Run this command to create the table that stores responses: npx wrangler d1 execute m2m-survey-responses --remote --file=survey/schema.sql
4. Run this command to actually deploy the new "worker" that will process the survey being sent: npx wrangler deploy