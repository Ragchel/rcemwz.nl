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

const binder = document.querySelector('[data-binder]');

if (binder) {
    const book = binder.querySelector('[data-binder-book]');
    const viewport = binder.querySelector('.binder-viewport');
    const previousButton = binder.querySelector('[data-binder-previous]');
    const nextButton = binder.querySelector('[data-binder-next]');
    const position = binder.querySelector('[data-binder-position]');
    const jumpForm = binder.querySelector('[data-binder-jump]');
    const pocketInput = jumpForm.querySelector('input');
    const dialog = document.querySelector('[data-card-dialog]');
    const dialogImage = dialog?.querySelector('[data-card-dialog-image]');
    const dialogTitle = dialog?.querySelector('[data-card-dialog-title]');
    const closeDialogButton = dialog?.querySelector('[data-card-dialog-close]');
    const totalCards = Number(binder.dataset.totalCards);
    const cardsPerSide = 16;
    const totalSides = Math.ceil(totalCards / cardsPerSide);
    const finalSpread = Math.ceil(totalSides / 2);
    const cardPath = binder.dataset.cardPath;
    const cardExtension = binder.dataset.cardExtension;
    let currentSpread = 0;
    let isTurning = false;

    const cardSource = (number) => `${cardPath}${number}.${cardExtension}`;

    const openCard = (number, source) => {
        if (!dialog || !dialogImage || !dialogTitle) return;

        dialogTitle.textContent = `Pocket ${number}`;
        dialogImage.src = source;
        dialogImage.alt = `Pokémon card in pocket ${number}`;
        dialog.showModal();
    };

    const makePocket = (number) => {
        const pocket = document.createElement('button');
        const numberLabel = document.createElement('span');
        const image = new Image();

        pocket.className = 'binder-pocket';
        pocket.type = 'button';
        pocket.disabled = true;
        pocket.setAttribute('aria-label', `Pocket ${number}, empty`);
        numberLabel.className = 'binder-pocket-number';
        numberLabel.textContent = number;
        image.alt = '';
        image.decoding = 'async';

        image.addEventListener('load', () => {
            pocket.disabled = false;
            pocket.classList.add('has-card');
            pocket.setAttribute('aria-label', `View card in pocket ${number}`);
            pocket.append(image);
        });

        image.addEventListener('error', () => image.remove());
        pocket.addEventListener('click', () => openCard(number, image.src));
        pocket.append(numberLabel);
        image.src = cardSource(number);

        return pocket;
    };

    const makePage = (side, positionOnSpread) => {
        const page = document.createElement('section');
        page.className = `binder-page binder-page--${positionOnSpread}`;

        if (!side) {
            page.classList.add('binder-page--cover');
            page.innerHTML = '<span aria-hidden="true">✿</span><p>rcemwz<br><small>Pokémon TCG collection</small></p>';
            page.setAttribute('aria-label', positionOnSpread === 'left' ? 'Inside front cover' : 'Inside back cover');
            return page;
        }

        const firstCard = ((side - 1) * cardsPerSide) + 1;
        const lastCard = Math.min(firstCard + cardsPerSide - 1, totalCards);
        page.setAttribute('aria-label', `Binder page ${side}, pockets ${firstCard} to ${lastCard}`);

        for (let number = firstCard; number <= lastCard; number += 1) {
            page.append(makePocket(number));
        }

        return page;
    };

    const getVisibleSides = () => {
        if (currentSpread === 0) return [0, 1];
        if (currentSpread === finalSpread) return [totalSides, 0];
        return [currentSpread * 2, (currentSpread * 2) + 1];
    };

    const renderSpread = () => {
        const [leftSide, rightSide] = getVisibleSides();
        const visibleSides = [leftSide, rightSide].filter(Boolean);
        const firstCard = ((Math.min(...visibleSides) - 1) * cardsPerSide) + 1;
        const lastCard = Math.min(Math.max(...visibleSides) * cardsPerSide, totalCards);

        book.replaceChildren(
            makePage(leftSide, 'left'),
            makePage(rightSide, 'right')
        );

        position.textContent = `Pockets ${firstCard}–${lastCard} · Spread ${currentSpread + 1} of ${finalSpread + 1}`;
        previousButton.disabled = currentSpread === 0;
        nextButton.disabled = currentSpread === finalSpread;
        viewport.scrollLeft = 0;
    };

    const goToSpread = (newSpread, direction) => {
        const boundedSpread = Math.max(0, Math.min(finalSpread, newSpread));
        if (boundedSpread === currentSpread || isTurning) return;

        isTurning = true;
        book.classList.add(direction === 'back' ? 'is-turning-back' : 'is-turning-forward');

        window.setTimeout(() => {
            currentSpread = boundedSpread;
            renderSpread();
            book.classList.remove('is-turning-back', 'is-turning-forward');
            isTurning = false;
        }, 160);
    };

    previousButton.addEventListener('click', () => goToSpread(currentSpread - 1, 'back'));
    nextButton.addEventListener('click', () => goToSpread(currentSpread + 1, 'forward'));

    viewport.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowLeft') {
            event.preventDefault();
            goToSpread(currentSpread - 1, 'back');
        }
        if (event.key === 'ArrowRight') {
            event.preventDefault();
            goToSpread(currentSpread + 1, 'forward');
        }
    });

    jumpForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const pocket = Math.max(1, Math.min(totalCards, Number(pocketInput.value)));
        if (!pocket) return;

        const side = Math.ceil(pocket / cardsPerSide);
        const spread = side === 1 ? 0 : Math.ceil((side - 1) / 2);
        goToSpread(spread, spread < currentSpread ? 'back' : 'forward');
    });

    closeDialogButton?.addEventListener('click', () => dialog.close());
    dialog?.addEventListener('click', (event) => {
        if (event.target === dialog) dialog.close();
    });

    renderSpread();
}
