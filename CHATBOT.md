# How chatbot responses are generated

The chatbot works the same way in all three conditions. It reuses a stored answer when one fits, and otherwise writes a new one, so participants get consistent answers that still fit their own conversation.

For each question:

1. **Does it depend on the previous message?** Questions like "why?" or "explain that more simply" get a newly written answer based on the chat so far.
2. **Has the participant already asked it in this chat?** If so, the chatbot explains the same idea a different way, with the same facts and a natural opening such as "I get why this is still tricky."
3. **Is there a stored answer?** A small AI model looks through the researcher-written FAQ answers and answers saved from earlier chats, and picks one only if it's about the same subject and gives the same information.
4. **The reply depends on what it found:**
   - **Stored answer, first question of the chat:** sent word for word.
   - **Stored answer, later in the chat:** lightly edited to fit the conversation, with most sentences unchanged.
   - **No stored answer:** the main AI model writes a new one using the lesson, the whole chat so far, and any related earlier answers. It's then saved for reuse, with references to that participant's chat removed.
   - **Several questions in one message:** each part is looked up separately and combined into one paragraph. A final check confirms every part was answered.

**Always sent word for word:**

- the fixed reply to questions about how the chatbot works;
- the answers to direct questions about the lesson's contradiction on the Turning of the Stone;
- short acknowledgements such as "Okay, glad to help."

**Instructions for every written answer:**

- Keep it to 2–4 sentences in one paragraph, ending with "Do you have another question about the lesson?"
- Small invented details are allowed if they fit the story, match what's already been said, and don't change the lesson's key ideas.
- Mention the Turning contradiction only if the participant explicitly asks about it, and never pick a side.
- Decline questions about the study design, how the chatbot works, or unrelated topics.

