document.documentElement.classList.add('js');

const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.site-navigation');

if (menuButton && navigation) {
    menuButton.addEventListener('click', () => {
        const isOpen = menuButton.getAttribute('aria-expanded') === 'true';

        menuButton.setAttribute('aria-expanded', String(!isOpen));
        menuButton.querySelector('.visually-hidden').textContent = isOpen
            ? 'Open navigation'
            : 'Close navigation';
        navigation.classList.toggle('is-open', !isOpen);
    });

    navigation.addEventListener('click', (event) => {
        if (event.target.matches('a')) {
            menuButton.setAttribute('aria-expanded', 'false');
            menuButton.querySelector('.visually-hidden').textContent = 'Open navigation';
            navigation.classList.remove('is-open');
        }
    });
}

document.querySelectorAll('[data-image]').forEach((slot) => {
    const image = new Image();

    image.alt = slot.dataset.alt || '';
    image.decoding = 'async';
    image.addEventListener('load', () => {
        slot.classList.add('has-image');
        slot.append(image);
    });
    image.src = slot.dataset.image;
});
