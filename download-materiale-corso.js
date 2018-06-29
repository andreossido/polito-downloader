class Source {
	constructor(type, path, name, code, liv){
		this.type = type;
		this.path = path;
		this.name = name;
		this.code = code;
		this.liv = liv;
	}
}

class Folder extends Source {
	constructor(path, name, code, liv){
		super('folder', path, name, code, liv)
	}

	getChildren(deepScan){
		if(!deepScan ||  deepScan < 0)
			deepScan = 0;
		return new Promise((resolve, reject) => {
			Downloader.instance.controllerApiHandler.list(Downloader.instance.controllerConfig.listUrl, this.path, (sourceModels, deferred) => {
				var promises = [];
				sourceModels.result.forEach((sourceModel) => {
					let path = this.path;
					if(path[path.length-1] != '/')
						path += '/';
					if(this.name != '/')
						path += this.name;
					switch(sourceModel.type){
						case 'file':
							promises.push(new File(path, sourceModel.name, sourceModel.nomefile, sourceModel.code, sourceModel.liv, sourceModel.size));
						break;

						case 'dir':
							if(sourceModel.code){
								promises.push(new Folder(path, sourceModel.name, sourceModel.code, sourceModel.liv));
								if(deepScan > 0)
									promises.push(promises[promises.length-1].getChildren(deepScan-1));
							}
						break;
					}
				});
                Promise.all(promises).then(function(children) {
                    resolve(children)
                });
				deferred.resolve(sourceModels);
			}, this.code);
		});
	}
}

class File extends Source {
	constructor(path, name, realFilename, code, liv, size){
		super('file', path, name, code, liv);
		this.size = size;
		this.realFilename = realFilename;
	}

	get downloadLink(){
		return Downloader.instance.controllerApiHandler.getUrl(Downloader.instance.controllerConfig.downloadFileUrl, this.path, this.code);
	}

	get downloadProgress(){
		return this.downloadedSize * 100 / this.size || 0;
	}

	download(progressCallback){
		return new Promise((resolve, reject) => {
			var xmlHttpRequest = new XMLHttpRequest();
			xmlHttpRequest.open("GET", this.downloadLink, 1);
			xmlHttpRequest.responseType = 'blob';
			xmlHttpRequest.onabort = () => {
				reject(`[${this.code}] Download aborted`);
			};
			xmlHttpRequest.onerror = () => {
				reject(`[${this.code}] Error in download`);
			};
			xmlHttpRequest.onprogress = (event) => {
				this.downloadedSize = event.loaded;
				this.size = event.total;
				if(progressCallback)
					progressCallback(this);
			};
			xmlHttpRequest.onload = xmlHttpRequestEvent => {
				let blob = xmlHttpRequest.response;
				this.blob = blob;
				resolve(this);
			}
			xmlHttpRequest.send();
		});
	}
}

class Downloader {
	constructor(controller){
		if(!Downloader._instance){
			if(controller){
				if(!window.controller)
					this.controller = angular.element('div[ng-controller="' + controller + '"]').scope();
				window.controller = this.controller;
			}
			Downloader._instance = this;
		}
		return Downloader._instance;
	}

	get controllerFileNavigator(){
		return this.controller.fileNavigator;
	}
	get controllerApiHandler(){
		return this.controller.apiMiddleware.apiHandler;
	}
	get controllerConfig(){
		return this.controller.config;
	}

	get currentViewingFolder(){
		return new Folder('/'+this.controllerFileNavigator.currentPath.join('/'), '/'+this.controllerFileNavigator.currentPath.join('/'), this.controllerFileNavigator.currentCode);
	}

	flat(arr){
		return arr.reduce((a, b) => a.concat(Array.isArray(b) ? this.flat(b) : b), []);
	}

	get nomeCorso(){
		return $('.row .col-md-12.col-sm-12 .RegionBorderMao h2 strong').html();
	}

	get downloadProgress(){
		this.progress = 0;
		this.files.forEach((file) => {
			this.progress += file.downloadProgress / this.files.length;
		});
		return this.progress;
	}

	static get instance(){
		return new Downloader('FileManagerCtrl');
	}

	downloadSources(args){
		let promises = [],
			me = this;
		this.files = Downloader.instance.flat(args.data).filter(child => { return child instanceof File});
		
		DownloadInfo.instance.action = 'Download';
		DownloadInfo.instance.color = 'rgb(8, 122, 252)';
		DownloadInfo.instance.progress = 0;
		DownloadInfo.instance.show();

		let chunkSize = args.simultaneousDownloads || 1,
			chunks = [];
		for(let i = 0, j = me.files.length; i < j; i += chunkSize)
			chunks.push(me.files.slice(i, i + chunkSize));

		chunks.forEach((files, fileIndex) => {
			promises.push(() => {
				let chunkPromises = [];
				files.forEach((file) => {
					chunkPromises.push(file.download(function(file){
						let progress = me.downloadProgress;
						DownloadInfo.instance.filename = file.name;
						if(progress > DownloadInfo.instance.progress){
							DownloadInfo.instance.progress = progress;
						}
						DownloadInfo.instance.update();
						delete me.files[fileIndex].blob;
					}));
				});
				return Promise.all(chunkPromises);
			});
		});
		me.promiseSerial(promises).then((children) => {
			if(args.zip){
				DownloadInfo.instance.action = 'Compressione';
				DownloadInfo.instance.color = 'rgb(252, 122, 8)';
				DownloadInfo.instance.progress = 0;
				DownloadInfo.instance.update();
				me.compressSources((args.zip.filename || 'output') + '.' + (args.zip.extension || 'zip'), children, (currentFile, progress) => {
					DownloadInfo.instance.filename = currentFile;
					DownloadInfo.instance.progress = progress;
					DownloadInfo.instance.update();
				}).then((filename) => {
					DownloadInfo.instance.hide();
				}).catch((error) => {
					DownloadInfo.instance.action = 'Errore';
					DownloadInfo.instance.color = 'rgb(252, 8, 8)';
					DownloadInfo.instance.filename = error;
					DownloadInfo.instance.progress = 100;
					DownloadInfo.instance.update();
				});
			} else {
				DownloadInfo.instance.hide();
			}
		});
	}

	compressSources(filename, children, progressCallback){
		return new Promise((resolve, reject) => {
			let zip = new JSZip();
			children.forEach(function(child) {
				var folder = zip.folder(child.path.slice(1));
				folder.file(child.realFilename, child.blob)
			});
			zip.generateAsync({
				type: "blob",
				streamFiles: true
			}, metadata => {
				progressCallback(metadata.currentFile, metadata.percent);
			}).then(function(content) {
				resolve(filename);
				saveAs(content, filename);
			})
		});
	}

	downloadCurrentFolder(args){
		let me = this,
			currentFolder = me.currentViewingFolder;
		currentFolder.getChildren(999).then((children) => {
			me.downloadSources(Object.assign({
				data: me.flat(children),
				simultaneousDownloads: 2,
				zip: {
					filename: me.nomeCorso + (currentFolder.name ? '_'+currentFolder.name : ''),
					extension: 'zip'
				}
			}, args));
		});
	}

	promiseSerial(funcs){
		return funcs.reduce((promise, func) =>
		promise.then(result => func().then(Array.prototype.concat.bind(result))),
		Promise.resolve([]))
	}
}

class DownloadInput {
	constructor(){
		if(!DownloadInput._instance){
			DownloadInput._instance = this;
			$('body').append(`<div id="abram-downloader-input_mask" style="width:100%; height:100%; position:fixed; top: 0; left: 0; background-color:rgba(0, 0, 0, 0.5)"></div><div class="modal fade in" id="abram-downloader-input_dialog" role="dialog" style="display: block"><div class="modal-dialog modal-lg" role="document"><div class="modal-content"><div class="modal-header" style="background-color: rgb(252, 122, 8)"><h4 class="modal-title text-white">Download materiale</h4></div><div class="modal-body"><div class="col-md-6"><h3>Download simultanei</h3><hr><div class="col-md-12 input-group"><input type="number" min="1" step="1" max="20" value="2" class="form-control" id="abram-downloader-input_download-simultanei" /></div></div><div class="col-md-6"><h3>Nome file</h3><hr><div class="col-md-12 input-group"><input type="text" value="${Downloader.instance.nomeCorso}" class="form-control" id="abram-downloader-input_nome-file" /></div></div><div class="col-md-12"><h3>Seleziona i file da scaricare</h3><hr><div class="list-group" style="width:100%; height:500px; overflow:scroll;" id="abram-downloader-input_filelist"></div></div><div class="modal-footer"><div id="abram-downloader-input_confirm-button" class="btn btn-default" style="background-color:rgb(252, 122, 8); color:#fff">Conferma</div></div></div></div>`);
			$('#abram-downloader-input_filelist').on('click', '.list-group-item', (event) => {
				let source = $(event.target);
				DownloadInput.instance.toggleSource(DownloadInput.instance.getSourceByDomElement(source));
			});
			$('#abram-downloader-input_dialog').on('click', '#abram-downloader-input_confirm-button', (event) => {
				DownloadInput.instance.hide();
				Downloader.instance.downloadSources({
					data: DownloadInput.instance.selectedFiles,
					simultaneousDownloads: $('#abram-downloader-input_download-simultanei').val(),
					zip: {
						filename: $('#abram-downloader-input_nome-file').val(),
						extension: 'zip'
					}
				});
			});
		}

		return DownloadInput._instance;
	}

	get selectedFiles(){
		return this.sources.filter((source) => source.selected);
	}

	getSourceByCode(code){
		return this.sources.filter((source) => source.code === code)[0];
	}

	getSourceByDomElement(dom){
		return this.sources.filter((source) => source.code === dom.attr('code'))[0];
	}

	toggleSource(source){
		if(source.selected)
			this.deselectSource(source);
		else
			this.selectSource(source);
	}

	selectSource(selectedSource){
		let domSelectedSource = selectedSource.obj;
		if(!selectedSource.selected){
			selectedSource.selected = true;
			if(selectedSource instanceof File){
				domSelectedSource.css('background-color', '#ceaf7f');
			} else {
				domSelectedSource.css('background-color', '#77befb');
				let nextDomSource = domSelectedSource.next(),
					nextSource = DownloadInput.instance.getSourceByDomElement(nextDomSource);
				while(nextSource && nextSource.liv > selectedSource.liv){
					DownloadInput.instance.selectSource(nextSource);

				 	nextDomSource = nextDomSource.next();
					nextSource = DownloadInput.instance.getSourceByDomElement(nextDomSource);
				}
			}
		}
	}

	deselectSource(selectedSource){
		let domSelectedSource = selectedSource.obj;
		domSelectedSource.css('background-color', '#ffffff');
	
		if(selectedSource instanceof Folder){
			let nextDomSource = domSelectedSource.next(),
				nextSource = DownloadInput.instance.getSourceByDomElement(nextDomSource);
			while(nextSource && nextSource.liv > selectedSource.liv){
				DownloadInput.instance.deselectSource(nextSource);

				nextDomSource = nextDomSource.next();
				nextSource = DownloadInput.instance.getSourceByDomElement(nextDomSource);
			}
		}
		
		selectedSource.selected = false;
	}

	show(){
		$('#abram-downloader-input_mask').show();
		$('#abram-downloader-input_dialog').show();
	}

	hide(){
		$('#abram-downloader-input_mask').hide();
		$('#abram-downloader-input_dialog').hide();
	}

	update(sources){
		this.sources = sources;
		let filelist = $('#abram-downloader-input_filelist');
		filelist.html('');
		sources.forEach((source, index) => {
			let obj = `<div class="list-group-item ${(source instanceof Folder ? 'text-primary' : 'text-warning')}" code="${source.code}" style="cursor:pointer">`;
			obj += `<div style="display:inline-block; width:${16*(source.liv-1)}px"></div>`;
			obj += `<i class="glyphicon glyphicon-${(source instanceof Folder ? 'folder-close' : 'file')} mr2"></i>${source.name}</div>`;
			obj = $(obj);
			filelist.append(obj);
			sources[index].obj = obj;
		})
	}

	static get instance(){
		return new DownloadInput();
	}
}

class DownloadInfo {
	constructor(){
		if(!DownloadInfo._instance){
			this.progress = 0;
			DownloadInfo._instance = this;
			$('body').append('<div id="abram-downloader-mask" style="width:100%; height:100%; position:fixed; top: 0; left: 0; background-color:rgba(0, 0, 0, 0.5)"></div><div class="modal fade in" id="abram-downloader-dialog" role="dialog"><div class="modal-dialog" role="document"><div class="modal-content"><div class="modal-header" id="abram-downloader-header"><h4 class="modal-title text-white" id="abram-downloader-title"></h4></div><div class="modal-body"><p id="abram-downloader-filename"></p><div class="progress"><div class="progress-bar" id="abram-downloader-progress" role="progressbar progress-bar-striped active" style="min-width: 2em; transition: none;"></div></div></div><div class="modal-footer"></div></div></div></div>');
		}

		return DownloadInfo._instance;
	}

	static get instance(){
		return new DownloadInfo();
	}

	show(){
		$('#abram-downloader-mask').show();
		$('#abram-downloader-dialog').show();
	}
	
	update(){
		$('#abram-downloader-title').html(this.action);
		$('#abram-downloader-filename').html(this.filename);
		$('#abram-downloader-header').css('background-color', this.color);
		$('#abram-downloader-progress').css('width', Math.round(this.progress)+'%').css('background-color', this.color);
		$('#abram-downloader-progress').html(Math.round(this.progress)+'%');
	}

	hide(){
		$('#abram-downloader-dialog').hide();
		$('#abram-downloader-mask').hide();
	}
}

$.getScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js", function(data, textStatus, jqxhr) {
    $.getScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/1.3.3/FileSaver.min.js", function(data, textStatus, jqxhr) {
        Downloader.instance.currentViewingFolder.getChildren(999).then((sources) => {
            DownloadInput.instance.show();
            DownloadInput.instance.update(Downloader.instance.flat(sources));
        });
    });
});