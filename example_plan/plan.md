AGENT: DO NOT USE THIS FILE, FOR HUMAN REVIEW ONLY.

-------

## foundation — codex

build me a notes app called scratch. vite + react + ts + tailwind. dark
mode. sidebar on the left with the list of notes (title + snippet of body),
main area is just a big textarea editor for the selected note. new note
button up top. notes persist in localStorage so they survive refresh.
clicking a note in the sidebar loads it in the editor. typing updates it
live. that's it, keep it clean and minimal, monospace feels right for this.
boot it with npm run dev so i can poke at it. use .tmp folder for this project.

--------

## round 1

### codex

plain text is killing me, i want markdown. render it nicely when im not
editing, let me toggle back to edit mode to change it. headings, bold,
lists, code blocks, links, the usual.

### claude

i want to find notes fast. add search. should feel instant.

### gemini

add tags to notes. i want to type #something in the note and have it become
a tag, and i want to filter the sidebar by tag.

--------

## round 2

### codex

i want to export a note as a .md file download, and import .md files back in
as new notes. drag and drop import would be sick.

### claude

let me pin notes to the top of the list. pinned ones stay up there, sorted
by most recently edited under that.

### gemini

dark mode is cool but sometimes i want light. add a theme toggle that
remembers my choice.