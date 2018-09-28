import $apngAndGif from './PixiApngAndGif'

const app = new PIXI.Application();

const loader = PIXI.loader,
    title = document.title,
    loadOption = {
        loadType: PIXI.loaders.Resource.LOAD_TYPE.XHR,
        xhrType: PIXI.loaders.Resource.XHR_RESPONSE_TYPE.BUFFER,
        crossOrigin:''
    },
    imgs = {
        gif:'http://isparta.github.io/compare/image/dongtai/gif/1.gif',
        apng:'http://isparta.github.io/compare/image/dongtai/apng/1.png'
        // gif:'./1.gif',
        // apng:'./1.png'
    };


loader.add(imgs.gif,loadOption);
loader.add(imgs.apng,loadOption);

loader.on('progress',(loader,resoure)=>{
    document.title = Math.round(loader.progress);
}).load((progress,resources)=>{
    document.title = title;

    window.gif = new $apngAndGif(imgs.gif,resources);
    window.apng = new $apngAndGif(imgs.apng,resources);

    let gifSprite = window.gif.sprite,
        apngSprite = window.apng.sprite;

    gifSprite.x = 100;
    apngSprite.x = 450;

    gifSprite.y = 160;
    apngSprite.y = 160;

    app.stage.addChild(gifSprite);
    app.stage.addChild(apngSprite);
});

document.body.appendChild(app.view);