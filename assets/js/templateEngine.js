function renderTemplate(template, vars) {
    let out = template;

    for (const [k, v] of Object.entries(vars)) {
        const rawValue = String(v);

        const tripleRe = new RegExp(`\\{\\{\\{\\s*${k}\\s*\\}\\}\\}`, 'g');
        const doubleRe = new RegExp(`\\{\\{\\s*${k}\\s*\\}\\}`, 'g');

        out = out.replace(tripleRe, rawValue);
        out = out.replace(doubleRe, rawValue);
    }

    return out;
}

