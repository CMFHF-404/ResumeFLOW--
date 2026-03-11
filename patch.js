import fs from 'fs';

const path = 'd:/ResumeFLOW项目/views/ResumeEditor/index.tsx';
let content = fs.readFileSync(path, 'utf8');

const target1 = `    const handleToggleJdCollapse = () => {\r
        setIsJDCollapsed((prev) => !prev);\r
    };`;
const target1Alt = `    const handleToggleJdCollapse = () => {\n        setIsJDCollapsed((prev) => !prev);\n    };`;

const replacement1 = `    const handleToggleJdCollapse = () => {
        setIsJDCollapsed((prev) => !prev);
    };
    const handleJdTextChange = useCallback(
        (value: string) => {
            setJdText(value);
            if (value.trim() === '') {
                setResumeName(DEFAULT_RESUME_TITLE);
            }
        },
        [setJdText]
    );`;

const target2 = `                        onJdTextChange: setJdText,`;
const replacement2 = `                        onJdTextChange: handleJdTextChange,`;

let modified = false;

if (content.includes(target1)) {
    content = content.replace(target1, replacement1);
    modified = true;
    console.log("Replaced target1 (with CR)");
} else if (content.includes(target1Alt)) {
    content = content.replace(target1Alt, replacement1);
    modified = true;
    console.log("Replaced target1 (without CR)");
} else {
    console.log("Could not find target1.");
}

if (content.includes(target2)) {
    content = content.replace(target2, replacement2);
    modified = true;
    console.log("Replaced target2");
} else {
    console.log("Could not find target2.");
}

if (modified) {
    fs.writeFileSync(path, content, 'utf8');
    console.log("Saved changes.");
}
