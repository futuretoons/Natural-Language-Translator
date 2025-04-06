# Natural Language Translator 

A powerful Visual Studio Code extension that enables real-time translation of text in your editor between English and various target languages. It supports dictionary management, compound word detection, and hover-over translations, making it ideal for developers, writers, and language enthusiasts working with multilingual code or content.

## INCLUDED LANGUAGES: 
  German, Spanish, French, Italian, Hindi, Vietnamese, Swedish, Romanian, Turkish, Dutch, Portuguese, Polish, Russian & Mandarin Chinese
  
## SUPPORTED NATURAL SCRIPTS:
    Latin, Cyrillic (only russian at the moment), Devanegari & Chinese. 

## Features

- **Toggle Translation**:  Switch between English and a target language with a single command.
- **Dynamic Dictionary Management**: Add or remove terms from your language dictionary directly within the editor.
- **Compound Word Support**: Automatically detects and translates compound terms (e.g., "camelCase" or "PascalCase").
- **Hover Information**: Hover over words to see their translations or original meanings.
- **Language Selection**: Choose your target language from a dropdown in the status bar.
- **Progress Feedback**: Visual progress bar during translation of large documents.
- **Persistent Mapping**: Tracks translations across edits with a robust mapping system.

## Installation

1. Install the extension from the [Visual Studio Code Marketplace](#).
2. Reload VSCode after installation.

## Usage

### Commands
- **`Toggle Translation`**: CTRL+SHIFT+T `vscode-translator.toggleTranslation`  
  Switches the current document between English and the selected target language.
- **`Add to Dictionary`**: CTRL+SHIFT+U `vscode-translator.addToDictionary`  
  Highlight a word, run the command, and enter its English meaning to add it to the dictionary.
- **`Remove from Dictionary`**: CTRL+SHIFT+i `vscode-translator.removeFromDictionary`  
  Highlight a word, select a meaning to remove, and update the dictionary.
- **`Select Dictionary`**: `vscode-translator.selectDictionary`  
  Choose a target language from the status bar dropdown.

### Status Bar
- **Translator Status**: Displays "Translator Enabled" or "Translator Disabled" based on the toggle state.
- **Language Selector**: Shows the current language (e.g., "Language: en") and allows switching.

### Hover
- Hover over a word in target language mode to see its English meaning, or in English mode to see its target language translation.

## Configuration

1. **Dictionary Files**: Each file should follow this format:
   JSON
   {
     "targetTerm": ["englishMeaning1", "englishMeaning2"],
     "anotherTerm": ["meaning"]
   }
   
## WORK IN PROGRESS: Japanese, Korean, Bengali & adding support for all Cyrillic languages..
