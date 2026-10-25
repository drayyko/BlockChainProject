// Create an instance of the smart contract, passing it as a property, which allows web3js to interact with it
function Documents() {
    this.web3 = null;
    this.instance = null;
}

Documents.prototype.showError = function(error) {
    var message = (error && (error.message || error.toString())) || "Unknown error";
    console.log(error);
    $("#error-alert").text(message).show();
}

// Initialize the `Documents` object and create an instance of the web3js library
Documents.prototype.init = function() {
    // The initialization function defines the interface for the contract using
    // the web3js contract object and then defines the address of the instance
    // of the contract for the `Documents` object

    // Create a new Web3 instance using the Metamask provider
    if (typeof window.ethereum !== 'undefined') {
        var that = this;
        this.web3 = new Web3(window.ethereum);

        var artifactPaths = ["../build/contracts/Documents.json", "/build/contracts/Documents.json", "./build/contracts/Documents.json"];

        function fetchJson(url) {
            return fetch(url).then(function(res) {
                if (!res.ok) {
                    throw new Error("Failed to load " + url + " (" + res.status + ")");
                }
                return res.json();
            });
        }

        function fetchArtifact(idx, lastError) {
            if (idx >= artifactPaths.length) {
                throw lastError;
            }
            return fetchJson(artifactPaths[idx]).catch(function(err) {
                return fetchArtifact(idx + 1, err);
            });
        }

        window.ethereum.request({ method: 'eth_requestAccounts' }).then(function () {
            return that.web3.eth.net.getId();
        }).then(function(networkId) {
            return fetchArtifact(0, new Error("Could not load contract artifact"))
                .then(function(artifact) {
                    return { artifact: artifact, networkId: String(networkId) };
                });
        }).then(function(ctx) {
            var artifact = ctx.artifact;
            var networkId = ctx.networkId;
            var contractAddress = artifact && artifact.networks && artifact.networks[networkId] && artifact.networks[networkId].address;

            if (!contractAddress) {
                console.log('No deployed contract found in artifact for network', networkId);
                that.showError(new Error("No deployed contract found for network " + networkId));
                return;
            }

            that.web3.eth.getCode(contractAddress).then(function(code) {
                if (!code || code === '0x') {
                    console.log('No contract deployed at address', contractAddress, 'for network', networkId);
                    that.showError(new Error("No contract deployed at address " + contractAddress + " for network " + networkId));
                    return;
                }

                that.instance = new that.web3.eth.Contract(artifact.abi, contractAddress);
            }).catch(function(error) {
                that.showError(error);
            });
        }).catch(function (error) {
            if (error && error.code === 4001) {
                $("#metamask-alert").show();
                return;
            }
            that.showError(error);
        });
    } else {
        this.web3 = new Web3();
        $("#metamask-alert").show();
    }
};

// Gets the message value stored on the instance of the contract
Documents.prototype.getDocument = function(hash, cb) {
    if (!this.instance) {
        cb(new Error("Contract not initialized"), null);
        return;
    }
    this.instance.methods.documents(hash).call(function(error, result) {
        cb(error, result);
    });
};

// Submits the hash of a document on the instance of the contract
Documents.prototype.submitHash = function() {
    var that = this;
    this.resetAlerts();
    var hash = $("#submit-hash").text();
    this.showLoader(true);

    this.getDocument(hash, function(error, result) {
        if (error) {
            console.log(error);
            that.showLoader(false);
            $("#error-alert").show();
            return;
        }

        if (result.exists) {
            that.showLoader(false);
            $("#existing-alert").show();
            return;
        }

        that.web3.eth.getGasPrice(function(error, gasPrice) {
            if (error) {
                console.log(error);
                that.showLoader(false);
                $("#error-alert").show();
                return;
            }

            that.web3.eth.getAccounts(function(error, accounts) {
                if (error) {
                    console.log(error);
                    that.showLoader(false);
                    $("#error-alert").show();
                    return;
                }

                that.instance.methods.addDocument(hash).estimateGas({from: accounts[0]},
                    function(error, gasAmount) {
                        if (error) {
                            console.log(error);
                            that.showLoader(false);
                            $("#error-alert").show();
                            return;
                        }
    
                        that.instance.methods.addDocument(hash).send(
                            {
                                from: accounts[0],
                                gas: gasAmount,
                                gasPrice: gasPrice
                            },
                            function(error, txHash) {
                                if (error) {
                                    console.log(error);
                                    that.showLoader(false);
                                    $("#error-alert").show();
                                    return;
                                }
    
                                that.waitForReceipt(txHash, function(receipt) {
                                    that.showLoader(false);
                                    if (receipt.status) {
                                        console.log({ receipt });
                                        $("#submit-alert").show();
                                    } else {
                                        console.log("transaction error");
                                        $("#error-alert").show();
                                    }
                                });
                            }
                        );
                    }
                );
            });
        });
    });
};

// Waits for receipt of transaction
Documents.prototype.waitForReceipt = function(hash, cb) {
    var that = this;

    // Checks for transaction receipt using web3 library method
    this.web3.eth.getTransactionReceipt(hash, function(err, receipt) {
        if (err) {
            console.log(err);
        }
        if (receipt !== null) {
            // Transaction went through
            if (cb) {
                cb(receipt);
            }
        } else {
            // Try again in 2 second
            window.setTimeout(function() {
                that.waitForReceipt(hash, cb);
            }, 2000);
        }
    });
};

// Hide or show the loader when performing async operations
Documents.prototype.showLoader = function(show) {
    document.getElementById("loader").style.display = show ? "block" : "none";
    var loaderRow = document.getElementById("loader-row");
    if (loaderRow) {
        loaderRow.style.display = show ? "flex" : "none";
    }
    document.getElementById("submit-button").style.display = show ? "none" : "inline-block";
    document.getElementById("search-button").style.display = show ? "none" : "inline-block";
}

// Resets the webpage alerts
Documents.prototype.resetAlerts = function() {
    $("#success-alert").hide();
    $("#submit-alert").hide();
    $("#existing-alert").hide();
    $("#notfound-alert").hide();
    $("#error-alert").hide();
};

// Sets the document hash for submission or search
Documents.prototype.setDocumentHash = function(evt) {
    var that = this;
    if (!window.File || !window.FileReader || !window.FileList) {
        console.log("File API not supported");
        return;
    }

    if (!evt || !evt.target || !evt.target.files || !evt.target.files[0]) {
        return;
    }

    if (!that.web3) {
        that.web3 = new Web3();
    }

    var fr = new FileReader();
    var input = evt.target;
    $(input).next('.custom-file-label').html(input.files[0].name);

    fr.onload = function() {
        var hash = that.web3.utils.soliditySha3(fr.result);
        var hashTarget = $(input).attr('id') === 'search-file-input' ? "#search-hash" : "#submit-hash";
        var buttonTarget = $(input).attr('id') === 'search-file-input' ? "#search-button" : "#submit-button";
        $(hashTarget).text(hash);
        $(buttonTarget).prop('disabled', false);
    };

    fr.readAsText(input.files[0]);
};

// Searches the smart contract for a given document hash
Documents.prototype.searchHash = function() {
    var that = this;
    this.resetAlerts();
    var hash = $("#search-hash").text();

    this.getDocument(hash, function(error, result) {
        if (error) {
            console.log(error);
            $("#error-alert").show();
            return;
        }

        if (!result.exists) {
            $("#notfound-alert").show();
            return;
        }

        that.web3.eth.getBlock(result.blockNumber, function(error, block) {
            if (error) {
                console.log(error);
                $("#error-alert").show();
                return;
            }
            $("#blocknumber").text(`${new Date(block.timestamp*1000)} (Block number: ${result.blockNumber})`);
            $("#success-alert").show();
        });
    });
};

// Bind event handlers to the buttons defined in app.html
Documents.prototype.bindButton = function() {
    var that = this;

    $(document).on("click", "#submit-button", function() {
        that.submitHash();
    });

    $(document).on("click", "#search-button", function() {
        that.searchHash();
    });

    $(document).on("change", "#submit-file-input", function(evt) {
        that.setDocumentHash(evt);
    });

    $(document).on("change", "#search-file-input", function(evt) {
        that.setDocumentHash(evt);
    });
};

Documents.prototype.main = function() {
    this.resetAlerts();
};

Documents.prototype.onReady = function() {
    this.init();
    this.bindButton();
    this.main();
};

var documents = new Documents();

$(document).ready(function() {
    documents.onReady();
});
