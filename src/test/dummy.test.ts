import test from 'ava';

const fn = async () => Promise.resolve('foo');

test(async t => {
    let x = await fn();
    let y = await fn();
    t.is(x + y, 'foofoo');
});
