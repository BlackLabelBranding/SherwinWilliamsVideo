(() => {
  const ivs = window.IVSPlayer;
  if (!ivs?.create || ivs.__swCompatPatched) return;

  try {
    const originalCreate = ivs.create.bind(ivs);

    ivs.create = (...args) => {
      const player = originalCreate(...args);

      if (player && typeof player.play === 'function' && !player.__swPlayPatched) {
        const originalPlay = player.play.bind(player);

        player.play = (...playArgs) => {
          const result = originalPlay(...playArgs);
          return result && typeof result.catch === 'function'
            ? result
            : Promise.resolve(result);
        };

        player.__swPlayPatched = true;
      }

      return player;
    };

    ivs.__swCompatPatched = true;
  } catch (error) {
    console.warn('IVS compatibility patch could not be applied.', error);
  }
})();
