// "Hide all text" button: fades the page content out to show off the background.

const button = document.querySelector('.text-toggle');

function setHidden(hidden) {
    document.documentElement.classList.toggle('text-hidden', hidden);

    // the label describes what pressing it will do
    const label = hidden ? 'Show text' : 'Hide text';
    button.setAttribute('aria-pressed', String(hidden));
    button.setAttribute('aria-label', label);
    button.title = label;
}

button.addEventListener('click', () => {
    setHidden(!document.documentElement.classList.contains('text-hidden'));
});
