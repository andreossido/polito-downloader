if(!window.flatten){
    window.flatten = arr => arr.reduce((a, b) => a.concat(Array.isArray(b) ? window.flatten(b) : b), []);
}
FileDownload = {
    init: function(controller) {
        this.downloadProgress = 0;
        this.totalFiles = 0;
        this.controller = window.controller;
        if(!window.controller){
            this.controller = angular.element('div[ng-controller="' + controller + '"]').scope();
            window.controller = this.controller;
        }
    },
    getController: function() {
        return this.controller;
    },
    getDownloadLink: function(fileModel) {
        return this.getController().apiMiddleware.apiHandler.getUrl(this.getController().config.downloadFileUrl, fileModel.downloadPath, fileModel.code)
    },
    downloadFile: function(file, fileIndex) {
        var me = this;
        return new Promise((resolve, reject) => {
            console.log("Downloading file...", file);
            var oReq = new XMLHttpRequest();
            oReq.open("GET", file.downloadLink, !0);
            oReq.responseType = "blob";
            oReq.onload = function(oEvent) {
                var blob = oReq.response;
                me.downloadProgress = fileIndex * 100 / me.totalFiles;
                document.getElementById('progressThumb').style.width = Math.floor(me.downloadProgress) + "%";
                document.getElementById('progressThumb').innerHTML = Math.floor(me.downloadProgress) + "%";
                resolve(blob)
            };
            oReq.send()
        })
    },
    downloadFiles: function(files, fileName, extension) {
        var me = this;
        document.body.innerHTML += '<div style="width:100%; height:100%; position:fixed; top: 0; left:0; background-color:rgba(0, 0, 0, 0.5); z-index:1;" id="hide"><div style="padding:20px; width:400px; height: 150px; position:fixed; left:50%; top:50%; margin-left:-220px; margin-top:-95px; border:2px solid #ddd; background-color:#eee"><div id="progressBar" style="margin-top:62px; height:25px; background-color:#ddd; width: 100%; line-height: 25px; text-align: center;"><div id="progressThumb" style="background-color:#07f; color:#fff; height:25px; width:0%;">0%</div></div></div></div>';
        $.getScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.1.5/jszip.min.js", function(data, textStatus, jqxhr) {
            $.getScript("https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/1.3.3/FileSaver.min.js", function(data, textStatus, jqxhr) {
                var zip = new JSZip(),
                    promises = [];
                me.totalFiles = files.length;
                files.forEach(function(file, fileIndex) {
                    promises.push(me.downloadFile(file, fileIndex))
                });
                Promise.all(promises).then(blobs => {
                    blobs.forEach(function(blob, index) {
                        var folder = zip.folder(files[index].path.slice(1));
                        folder.file(files[index].fileName, blob)
                    });
                    zip.generateAsync({
                        type: "blob"
                    }).then(function(content) {
                        fileName = $('.row .col-md-12.col-sm-12 .RegionBorderMao h2 strong').html() +(fileName.length > 0 ? '_' : '')+ fileName;
                        saveAs(content, fileName+'.'+extension);
                        document.getElementById('hide').parentNode.removeChild(document.getElementById('hide'))
                    })
                })
            })
        })
    },
    getFiles: function(path, code) {
        var me = this;
        return new Promise((resolve, reject) => {
            me.getItems(path, code).then(function(promises) {
                resolve(window.flatten(promises));
            })
        })
    },
    getItems: function(directoryPath, directoryCode) {
        var promises = [],
            me = this;
        return new Promise((resolve, reject) => {
            this.getController().apiMiddleware.apiHandler.list(this.getController().config.listUrl, directoryPath, function(fileModels, deferred) {
                var items = [];
                fileModels.result.forEach(function(fileModel, index) {
                    fileModel.path = directoryPath;
                    fileModel.downloadPath = fileModel.path + '/' + fileModel.name;
                    fileModel.downloadPath = fileModel.downloadPath.replace(/\/\//g, "/");
                    switch (fileModel.type) {
                        case 'file':
                            console.info("New file...", fileModel);
                            promises.push({
                                downloadLink: me.getDownloadLink(fileModel),
                                fileName: fileModel.nomefile,
                                path: fileModel.path
                            });
                            break;
                        case 'dir':
                            if (fileModel.code) {
                                items.push(fileModel);
                                promises.push(me.getItems(fileModel.downloadPath, fileModel.code))
                            };
                            break
                    }
                });
                Promise.all(promises).then(function(values) {
                    resolve(values)
                });
                return deferred.resolve(fileModels)
            }, directoryCode)
        })
    }
};
FileDownload.init('FileManagerCtrl');
var path = '/'+controller.fileNavigator.currentPath.join('/'),
    code = controller.fileNavigator.currentCode;
FileDownload.getFiles(path, code).then((files) => {
    FileDownload.downloadFiles(files, path.slice(1), "zip")
})