import os

from elevenlabs import generate, play, set_api_key


def build_question_tts_text(question):
    """Build the clearly labeled script sent to ElevenLabs."""
    tts = question.get("tts", question)
    choices = tts["choices"]
    explanations = tts.get("explanations", [""] * len(choices))

    # TTS SECTION 1: QUESTION TEXT
    sections = [f"QUESTION: {tts['question']}"]

    # TTS SECTION 2: ANSWER CHOICES
    sections.append("ANSWER CHOICES:")
    sections.extend(f"Choice {'ABCD'[index]}: {choice}" for index, choice in enumerate(choices))

    # TTS SECTION 3: EXPLANATIONS FOR EACH ANSWER CHOICE
    sections.append("EXPLANATIONS:")
    sections.extend(
        f"Explanation for choice {'ABCD'[index]}: {explanation}"
        for index, explanation in enumerate(explanations)
        if explanation
    )
    return "\n\n".join(sections)


def speak_question(question):
    """Send one question's text, choices, and explanations to ElevenLabs."""
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise RuntimeError("Set the ELEVENLABS_API_KEY environment variable first.")

    set_api_key(api_key)
    audio = generate(
        text=build_question_tts_text(question),
        voice="Rachel",
        model="eleven_multilingual_v2",
    )
    play(audio)
