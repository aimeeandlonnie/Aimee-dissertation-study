**The original HPL study was created by Blerim Jasahri.** This template version with more detailed instructions was copied from Blerim's study by Ilona Bass.

# Getting this study running

The code in this repo is complete but not connected to anything yet. You need five
free accounts (GitHub, Firebase, Vercel, DataPipe, Dataverse), an OpenAI API key with a few dollars
loaded onto it, and about an hour of time. Here's the order that works best.

First, copy this GitHub template (Use this template > Create a new repository). Then follow the steps below.

## 1. Create a temporary local file for storing keys

Create an Excel file with the following values in the first column:
   - `FIREBASE_SERVICE_ACCOUNT_BASE64`
   - `FIREBASE_DATABASE_URL`
   - `OPENAI_API_KEY`
   - `DATAVERSE_API_TOKEN`
   - `DATAPIPE MAIN EXPERIMENT ID`
   - `DATAPIPE CONSENT EXPERIMENT ID`
   - `DATAPIPE XLSX EXPERIMENT ID`
   - `DATAPIPE EMAIL EXPERIMENT ID`
   
This is just for keeping track of these values temporarily as they're generated. **No API key, secret, or service credential is ever placed in `index.html`, any other client-side file, or any committed file in this repo. Ever.**

## 2. Firebase (the study's database)

This stores participant IDs, condition assignments, and the shared chatbot cache.

1. Go to https://console.firebase.google.com and add a project (any name).
2. In the left menu: Build > Realtime Database > Create database. Pick a US region
   and start in **locked mode**. Important: it has to be Realtime Database, not
   Firestore. They look similar in the menu but the code only talks to Realtime.
3. In the rules tab:

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "email_hashes": {
      "$hash": {
        ".read": true,
        ".write": false
      }
    }
  }
}
```
   Then publish.
   
4. Download a private key for the project (Gear icon > Project settings > Service accounts > Generate new private key).
   This will download a .json file. 
5. Turn that file into one long line of text. On a Mac:
   `base64 -i ~/Downloads/yourfile.json | pbcopy` (this "converts" the entire contents 
   of the .json file into a single string, and saves it to your clipboard.) 
   **Paste this into your Excel spreadsheet next to `FIREBASE_SERVICE_ACCOUNT_BASE64`**, then DELETE the downloaded .json file.
6. Copy your database URL from the top of the Data tab. It looks like
   https://yourproject-default-rtdb.firebaseio.com. **Paste this into your Excel**
   **spreadsheet next to `FIREBASE_DATABASE_URL`.** 
   NOTE: Make sure the URL DOES NOT have a "/" at the end.

## 3. Dataverse (where the final data files land)

1. Make an account at https://dataverse.harvard.edu/ (Harvard Dataverse).
2. Create a "Dataverse" (Add Data > New Dataverse)
      - **Host Dataverse**: Keep as "Harvard Dataverse"
      - **Dataverse Name**: Whatever you want the title of this research project to be
        (e.g., "Lonnie's HPL Study Clone")
      - **Identifier**: The "short-title" that gets appended to the end of
        this Dataverse's URL (e.g., "hpl-study-lb"). NOTE: You will need this when
        setting up your DataPipe experiments in the next step.
      - **Category**: Research Project
   Everything else is optional and can be left blank or as-is.

3. Create an API Token on Dataverse (click your username the top-right > API Token > Create Token). **Paste this into your Excel spreadsheet next to `DATAVERSE_API_TOKEN`.**

## 4. DataPipe (the intermediary between the study and Dataverse)

1. Make an account at https://pipe.jspsych.org (DataPipe), using
   whatever sign-in method you prefer (email, Google, GitHub, etc.).
2. Link your DataPipe account to Dataverse (Account > Settings > Dataverse > Connect)
     - **Dataverse Server URL**: https://dataverse.harvard.edu/
     - **API Token**: The value you pasted in your Excel spreadsheet under `DATAVERSE_API_TOKEN`.
       (Can also be re-accessed on your Dataverse account, though you should not need this
       token again after this point.)
3. In DataPipe, create **FOUR unique experiments**:
      1.  **Main**: For the primary .json output from the study.
      2.  **Consents**: For consent form PDFs.
      3.  **Emails**: For email .json files, to store participant contacts.
      4.  **XLSX**: For the .xlsx files of each participant's data.

   Create each experiment in the following way:
     - **Title**: An informative study title (e.g., "Lonnie's HPL Study Clone - Consents").
       NOTE: When you create an experiment in DataPipe, it will automatically create a
       collection in Dataverse with the same title that you set here.
     - **Collection alias**: The "Identifier" you chose when setting up your
       Dataverse in the previous step.

   Everything else should be self-explanatory (e.g. name, email, etc.).

4. Configure the four DataPipe experiments:
     - For your "Main" experiment:
         - Turn on "Accept new data"
         - Turn on "Validation"
         - Check "Allow JSON" and "Allow CSV"
         - Make sure the "Required fields" field is empty
     - For your other three experiments:
         - Turn on "Accept new data"
         - Turn on "Accept base64 file uploads"
         - Turn OFF "Validation"
      
   No other changes should be necessary.

5. Once all four experiments are created, locate their experiment IDs (under "Experiment details"
   for each experiment -- should be a short code like hz6pAcxZd4Xd).
   **Paste each experiment ID into your Excel spreadsheet next to the corresponding `EXPERIMENT ID` label.**

## 5. OpenAI (enables chatbot access)

1. Log in or make an account at https://platform.openai.com
2. You'll need to have billing set up and at least a few dollars added to your account in order to start using the API Key.
3. After you've set up the billing, create the API Key. In the side menu, click API Keys, then Create New Secret Key in the top-right. Name, project, and expiration are up to you; Permissions can be set to All. Click Create Secret Key. **Paste this into your Excel spreadsheet next to `OPENAI_API_KEY`.** NOTE: Once you close this window, you WILL NOT be able to view this secret key again.
4. For security purposes, it's good practice to have spending limits in place for the project: In the side menu, click Settings > Limits tab, and input a limit for how much you want to spend each month.
5. You can also limit the models that the project is able to use: In the same Limits menu, Allow or Block Models > Allow only selected models, and limit to `gpt-5.4`, `gpt-5.4-mini`, `gpt-4o-mini`, and `text-embedding-3-small`.

## 6. Edit `index.html` (connects this repo to your study-specific information)

In the `index.html` file in your copy of this repo, replace the following values:
-  `[REPLACE ME! Researcher Name]`: Replace with your first and last name (e.g. "Ilona Bass"). Replace 5 times.
-  `[REPLACE ME! Researcher Email]`: Replace with your email address (e.g. "ibass@fas.harvard.edu"). Replace 7 times.
-  `[REPLACE ME! Firebase URL]`: Replace with the URL in your Excel spreadsheet next to `FIREBASE_DATABASE_URL`. **Make sure there's no "/" at the end!** Replace 1 time.
-  `[REPLACE ME! Datapipe Main Experiment ID]`: Replace with the experiment ID in your Excel spreadsheet next to `DATAPIPE MAIN EXPERIMENT ID`. Replace 1 time.
-  `[REPLACE ME! Datapipe Consent Experiment ID]`: Replace with the experiment ID in your Excel spreadsheet next to `DATAPIPE CONSENT EXPERIMENT ID`. Replace 1 time.
-  `[REPLACE ME! Datapipe XLSX Experiment ID]`: Replace with the experiment ID in your Excel spreadsheet next to `DATAPIPE XLSX EXPERIMENT ID`. Replace 1 time.
-  `[REPLACE ME! Datapipe Email Experiment ID]`: Replace with the experiment ID in your Excel spreadsheet next to `DATAPIPE EMAIL EXPERIMENT ID`. Replace 1 time.

For all of these, replace the entire bracketed string, including the brackets themselves.

Once you've made all of these replacements, commit changes. You can also edit the study-specific information in `package.json`.

NOTE: All of the content of the template study is HPL-specific. Poke around the entire repo and edit all study content to work for your task or experiment.

## 7. Vercel (puts it on the internet)

1. Make an account at https://vercel.com with "Continue with GitHub". Link the GitHub account that houses this repo.
2. Add New > Project > import this repo. Because this repo is private, you may have to click "Adjust GitHub App Permissions" and expressly allow access to this repo. Do not change any build settings for the project on Vercel.
3. Before hitting Deploy, add these environment variables (should be logged in your Excel spreadsheet):

   - `FIREBASE_SERVICE_ACCOUNT_BASE64` - a super long string
   - `FIREBASE_DATABASE_URL` - the Firebase URL
   - `OPENAI_API_KEY` - the OpenAI API secret key
   - `TOKEN_SECRET` - any random string, 32+ characters (you never need to
     remember it); e.g. can make one on https://numbergenerator.org/random-32-digit-number-generator

   There are also a few optional ones you probably won't need: `ALLOWED_ORIGINS`
   (only if another domain needs to call the API), `PER_IP_TOKEN_LIMIT` (default
   15 tokens per IP per hour) and `PER_TOKEN_CALL_LIMIT` (default 500 calls per
   session).

4. Deploy. You get a live URL like https://something.vercel.app after a minute.
   Every git push after this redeploys automatically.

NOTE: Changing an environment variable in Vercel needs a redeploy to take effect.

## 8. Check it works

Open your URL and run through the whole study once like a participant. Then check:
your Firebase Data tab should show a participant counter and session data, and each of your four 
Dataverse collections should have one new file in them. If everything is there, congratulations! 
Once you're done testing, make sure to delete your test entries from the Firebase Data tab (hover a node, three dots, delete), and your test data from the Dataverse collections.
For security, you should now delete the Excel file that has been storing all your secret key information.

NOTE: DataPipe is sometimes slow to send data to Dataverse. If you still don't see anything after a day or so, try disconnecting and re-connecting DataPipe and Dataverse using a freshly generated Dataverse API Token. 

TIP: If you want to test the study multiple times, you can create email aliases to imitate unique participants (e.g. "ibass+test2@fas.harvard.edu").

TIP: add `?researcher-access` to the end of the Vercel URL to get the researcher panel for faster
clicking around while testing. The researcher view should not upload data to DataPipe/Dataverse, or count towards the condition counterbalancing in Firebase -- but double-check these all the same once you're done testing, and delete / reset these values if necessary.
