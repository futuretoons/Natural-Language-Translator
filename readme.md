# Natural Language Translator 

Translate code documents into other natural languages(es,fr,zh,ru,ect..).
Select a variety of local dictionaries to translate documents word by word. 
With a simple keybind(command) your document goes back to english! 

Visual Studio Code extension that enables translation of text in your editor between English and various natural languages. It supports dictionary management(add/remove terms), compound word detection, and hover tool tip translations, making it ideal for developers, writers, and language enthusiasts working with multi-lingual computer programs or other content.. When translation a document from english to a foreign language it will automatically find new capitalization variants of english words and update the dictionary to support that new variant. 

## Warning:
You can view documents in other languages and you can also edit them. 
Be warned editing in other languages is experimental and you should take your time and frequently go back and forth to english to ensure the translation is correct. 
also only have 1 document at a time that is translated into a foreign language. 
This is an experimental plugin and only supports the translation of 1 document at a time. 

## INCLUDED LANGUAGE DICTIONARIES: 
  German(Deutsch), Spanish(español), French(français), Italian(italiano), Swedish(svenska), Romanian(română), Ukrainian(україн), Turkish(Türkçe), Dutch(Nederlands), Portuguese(português), Polish(polski), Russian(русский), Mandarin Chinese(中文), Hindi(हिन्दी)
  
## SUPPORTED NATURAL SCRIPTS:
    Latin, Cyrillic, Devanegari & Chinese. 

## Features

- **Toggle Translation**:  Switch between English and a target language with a single command.
- **Dynamic Dictionary Management**: Add or remove terms from your language dictionary directly within the editor.
- **Compound Word Support**: Automatically detects and translates compound terms (e.g., "camelCase" or "PascalCase").
- **Hover Information**: Hover over words to see their translations or original meanings.
- **Language Selection**: Choose your target language from a dropdown in the status bar.
- **Progress Feedback**: Visual progress bar during translation of large documents.
- **Persistent Mapping**: Tracks translations across edits with a robust mapping system.

## Installation

1. Install the extension from the [Visual Studio Code Marketplace](#)(Search Natural Language Translator).
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
- **Language Selector**: Shows the current language (e.g., "Language: en") and allows switching dictionaries.

### Hover  
- Hover over a word in your selected language mode post translation to see its English meaning.

## Configuration

1. **Dictionary Files**: Each file should follow this format:
   JSON
   {
     "targetTerm": ["englishMeaning1", "englishMeaning2"],
     "anotherTerm": ["meaning1"],
     "yetAnotherTerm": ["meaning2"]

   }
   

## How does it work?
This program is essentially a processor that tokenizes every term in the vscode document and creates a map of each occurance and position for each term..
Terms are delimited by spaces and also special characters like <>?>:"{}+_)(*&^%$ ect... The program then uses json dictionaries installed locally and can be modified in runtime. The program parses through every word in the document and translates each word using the selected JSON dictionary. The result is then stored in a map. We can even map what I like to call 'Compound terms' which are just terms stuck together like camelCase or PascalCaseWordsLikeThis. The program
forms a map of all compound terms and translates each term within each compound and maps the translation appropriately.

## Why did I make this??
Stemmed from curiosity of wanting to know how others can view computer programs / code in their primary natural language. Also this was an incredible oportunity to learn and reseach about linguistics, tokenization, programming language semantics, unicode ranges, ect.. 

## WORK IN PROGRESS
--Currently working on adding support for other scripts such as Korean, Bengali, Japanese, ect.. 
-- Adding intellisense integration to allow for much better UX. 
fix bugs when editing in other languages and expanding support for all scripts. 

This project is open source research project and i would be happy to accept help from anyone intested in improving this tool to make programming more versitile. 


Also leave a review on the VSCODE marketplace, Github,
 or send me an Email at 'Business.liamearley@gmail.com'

--Research & Development by Liam Earley @2025--
