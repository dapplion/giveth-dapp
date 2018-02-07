import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { LPPCappedMilestones } from 'lpp-capped-milestone-token';
import { utils } from 'web3';

import { Form, Input } from 'formsy-react-components';
import { feathersClient } from './../../lib/feathersClient';
import Loader from './../Loader';
import QuillFormsy from './../QuillFormsy';
import SelectFormsy from './../SelectFormsy';
import DatePickerFormsy from './../DatePickerFormsy';

import FormsyImageUploader from './../FormsyImageUploader';
import GoBackButton from '../GoBackButton';
import {
  isOwner,
  displayTransactionError,
  getRandomWhitelistAddress,
  getTruncatedText,
  getGasPrice,
} from '../../lib/helpers';
import {
  isAuthenticated,
  checkWalletBalance,
  isInWhitelist,
  confirmBlockchainTransaction,
} from '../../lib/middleware';
import getNetwork from '../../lib/blockchain/getNetwork';
import getWeb3 from '../../lib/blockchain/getWeb3';
import LoaderButton from '../../components/LoaderButton';
import User from '../../models/User';
import GivethWallet from '../../lib/blockchain/GivethWallet';
import MilestoneItem from '../../components/MilestoneItem';
import moment from 'moment';

import Toggle from 'react-toggle'
import AddMilestoneItem from '../../components/AddMilestoneItem';

/**
 * Create or edit a Milestone
 *
 *  @props
 *    isNew (bool):
 *      If set, component will load an empty model.
 *      If not set, component expects an id param and will load a milestone object from backend
 *
 *  @params
 *    id (string): an id of a milestone object
 */

class EditMilestone extends Component {
  constructor() {
    super(); 

    this.state = {
      isLoading: true,
      isSaving: false,
      formIsValid: false,

      // milestone model
      title: '',
      description: '',
      image: '',
      maxAmount: '',
      fiatAmount: 10,
      reviewerAddress: getRandomWhitelistAddress(
        React.whitelist.reviewerWhitelist,
      ).address,
      recipientAddress: '',
      // completionDeadline: '',
      status: 'pending',
      uploadNewImage: false,
      campaignTitle: '',
      projectId: undefined,
      hasWhitelist: React.whitelist.reviewerWhitelist.length > 0,
      whitelistReviewerOptions: React.whitelist.reviewerWhitelist.map(r => ({
        value: r.address,
        title: `${r.name ? r.name : 'Anonymous user'} - ${r.address}`,
      })),
      items: [],
      itemizeState: true,
      conversionRates: [],
      currentRate: undefined,
      date: moment(),
      fiatTypes: [
        {value: 'USD', title: 'USD'},
        {value: 'EUR', title: 'EUR'},
        {value: 'GBP', title: 'GBP'},
        {value: 'CHF', title: 'CHF'},
        {value: 'MXN', title: 'MXN'},
        {value: 'THB', title: 'THB'}
      ], 
      selectedFiatType: 'EUR',
    };

    this.submit = this.submit.bind(this);
    this.setImage = this.setImage.bind(this);
    this.setMaxAmount = this.setMaxAmount.bind(this);
    this.setFiatAmount = this.setFiatAmount.bind(this);
    this.changeSelectedFiat = this.changeSelectedFiat.bind(this);
  }

  componentDidMount() {
    isAuthenticated(this.props.currentUser, this.props.wallet)
      .then(() => {
        if (!this.props.isProposed)
          checkWalletBalance(this.props.wallet, this.props.history);
      })
      .then(() => {
        if (!this.props.isProposed) {
          isInWhitelist(
            this.props.currentUser,
            React.whitelist.projectOwnerWhitelist,
            this.props.history,
          );
        }
      })
      .then(() =>
        // load eth conversion for today
        this.getEthConversion()
      )
      .then(() => {
        this.setState({
          campaignId: this.props.match.params.id,
          recipientAddress: this.props.currentUser.address,
        });

        // load a single milestones (when editing)
        if (!this.props.isNew) {
          feathersClient
            .service('milestones')
            .find({ query: { _id: this.props.match.params.milestoneId } })
            .then(resp => {
              if (
                !isOwner(resp.data[0].owner.address, this.props.currentUser)
              ) {
                this.props.history.goBack();
              } else {
                this.setState(
                  Object.assign({}, resp.data[0], {
                    id: this.props.match.params.milestoneId,
                    maxAmount: utils.fromWei(resp.data[0].maxAmount),
                    isLoading: false,
                    hasError: false,
                  }),
                );
              }
            })
            .catch(() =>
              this.setState({
                isLoading: false,
              }),
            );
        } else {
          feathersClient
            .service('campaigns')
            .get(this.props.match.params.id)
            .then(campaign => {
              if (!campaign.projectId) {
                this.props.history.goBack();
              } else {
                this.setState({
                  campaignTitle: campaign.title,
                  campaignProjectId: campaign.projectId,
                  campaignReviewerAddress: campaign.reviewerAddress,
                  campaignOwnerAddress: campaign.ownerAddress,
                  isLoading: false,
                });
              }
            });
        }
      })
      .catch(err => {
        if (err === 'noBalance') this.props.history.goBack();
      });
  }

  setImage(image) {
    this.setState({ image, uploadNewImage: true });
  }

  setDate(moment) {
    this.setState({ date: moment });
    this.getEthConversion(moment).then((resp) => {
      // update all the input fields
      const rate = resp.rates[this.state.selectedFiatType];
      
      this.setState({ 
        currentRate: resp,
        maxAmount: this.state.fiatAmount / rate
      })
    });
  }

  submit(model) {
    this.setState({ isSaving: true });

    const afterEmit = () => {
      this.setState({ isSaving: false });
      this.props.history.goBack();
    };
    let txHash;

    console.log(model);

    const updateMilestone = file => {
      const constructedModel = {
        title: model.title,
        description: model.description,
        summary: getTruncatedText(this.state.summary, 100),
        maxAmount: utils.toWei(model.maxAmount.toFixed(18)),
        ownerAddress: this.props.currentUser.address,
        reviewerAddress: model.reviewerAddress,
        recipientAddress: model.recipientAddress,
        // completionDeadline: this.state.completionDeadline,
        campaignReviewerAddress: this.state.campaignReviewerAddress,
        image: file,
        campaignId: this.state.campaignId,
        status:
          this.props.isProposed || this.state.status === 'rejected'
            ? 'proposed'
            : this.state.status, // make sure not to change status!
        items: this.state.items,
        ethConversionRateTimestamp: this.state.currentRate.timestamp,
        selectedFiatType: this.state.selectedFiatType
      };

      if (this.props.isNew) {
        const createMilestone = txData => {
          feathersClient
            .service('milestones')
            .create(Object.assign({}, constructedModel, txData))
            .then(() => afterEmit(true));
        };

        if (this.props.isProposed) {
          createMilestone({
            pluginAddress: '0x0000000000000000000000000000000000000000',
            totalDonated: '0',
            donationCount: 0,
            campaignOwnerAddress: this.state.campaignOwnerAddress,
          });
          React.toast.info(
            <p>Your Milestone is being proposed to the Campaign Owner.</p>,
          );
        } else {
          let etherScanUrl;
          Promise.all([getNetwork(), getWeb3(), getGasPrice()])
            .then(([network, web3, gasPrice]) => {
              etherScanUrl = network.txHash;

              const from = this.props.currentUser.address;
              const recipient = model.recipientAddress;
              new LPPCappedMilestones(web3, network.cappedMilestoneAddress)
                .addMilestone(
                  model.title,
                  '',
                  constructedModel.maxAmount,
                  this.state.campaignProjectId,
                  recipient,
                  model.reviewerAddress,
                  constructedModel.campaignReviewerAddress,
                  { from, gasPrice },
                )
                .on('transactionHash', hash => {
                  txHash = hash;
                  createMilestone({
                    txHash,
                    pluginAddress: '0x0000000000000000000000000000000000000000',
                    totalDonated: '0',
                    donationCount: '0',
                  });
                  React.toast.info(
                    <p>
                      Your Milestone is pending....<br />
                      <a
                        href={`${etherScanUrl}tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View transaction
                      </a>
                    </p>,
                  );
                })
                .then(() => {
                  React.toast.success(
                    <p>
                      Your Milestone has been created!<br />
                      <a
                        href={`${etherScanUrl}tx/${txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        View transaction
                      </a>
                    </p>,
                  );
                });
            })
            .catch(() => {
              displayTransactionError(txHash, etherScanUrl);
            });
        }
      } else {
        feathersClient
          .service('milestones')
          .patch(this.state.id, constructedModel)
          .then(() => afterEmit());
      }
    };

    const saveMilestone = () => {

      const uploadMilestoneImage = () => {
        if (this.state.uploadNewImage) {
          feathersClient
            .service('/uploads')
            .create({ uri: this.state.image })
            .then(file => updateMilestone(file.url));
        } else {
          updateMilestone();
        }      
      }

      if(this.state.itemizeState) {
        let uploadPromises = [];

        // upload all the item images
        const uploadItemImages = new Promise((resolve, reject) => 
          this.state.items.forEach((item, index) =>
            feathersClient
              .service('/uploads')
              .create({ uri: item.image })
              .then((file) => {
                item.image = file.url;
                if(index === 0) resolve('done');
              })
            )
          )
        
        uploadItemImages.then(() => uploadMilestoneImage());

      } else {
        uploadMilestoneImage();
      }
    };

    if (this.props.isProposed) {
      React.swal({
        title: 'Propose milestone?',
        text:
          'The milestone will be proposed to the campaign owner and he or she might approve or reject your milestone.',
        icon: 'warning',
        dangerMode: true,
        buttons: ['Cancel', 'Yes, propose'],
      }).then(isConfirmed => {
        if (isConfirmed) saveMilestone();
      });
    } else if (this.props.isNew) {
      // Save the Milestone
      confirmBlockchainTransaction(
        () => saveMilestone(),
        () => this.setState({ isSaving: false }),
      );
    } else {
      saveMilestone();
    }
  }

  toggleFormValid(state) {
    this.setState({ formIsValid: state });
  }

  constructSummary(text) {
    this.setState({ summary: text });
  }

  btnText() {
    if (this.props.isNew) {
      return this.props.isProposed ? 'Propose Milestone' : 'Create Milestone';
    }

    return 'Update Milestone';
  }

  addItem(item) {
    console.log(item);
    this.setState({ items: this.state.items.concat(item)});
  }

  removeItem(index) {
    let items = this.state.items;
    delete items[index];
    this.setState({ items: items.filter(x => true) });
  }

  mapInputs(inputs) {
    let data = {
      title: inputs.title,
      description: inputs.description,
      reviewerAddress: inputs.reviewerAddress,
      recipientAddress: inputs.recipientAddress,
      items: this.state.items,
      maxAmount: 0     
    }

    // in itemized mode, we calculate the maxAmount from the items
    if(this.state.itemizeState) {
      this.state.items.forEach((item) => data.maxAmount += parseFloat(item.etherAmount))
    } else {
      data.maxAmount = inputs.maxAmount;
    }

    return data;
  }

  toggleItemize () {
    this.setState({ itemizeState: !this.state.itemizeState })
  }

  getEthConversion (date) {
    // generate utc timestamp, set at start of day
    const utcDate = new Date(date).setUTCHours(0,0,0,0);
    const timestamp = Math.round(utcDate) / 1000; 

    const conversionRates = this.state.conversionRates;
    const cachedConversionRate = conversionRates.filter((c) => c.timestamp === timestamp);

    if(cachedConversionRate.length === 0) {
      // we don't have the conversion rate in cache, fetch from feathers
      return feathersClient
        .service('ethconversion')
        .find({query: { date: date }})
        .then(resp => {
          
          this.setState({ 
            conversionRates: conversionRates.concat(resp),
            maxAmount: this.state.fiatAmount / resp.rates[this.state.selectedFiatType],
            currentRate: resp 
          })            

          return resp;
        })   
    } else {  
      // we have the conversion rate in cache
      return new Promise((resolve, reject) => {
        this.setState(
          {currentRate: cachedConversionRate[0]}, 
          () => resolve(cachedConversionRate[0])
        );
      });
    }
  }

  setMaxAmount(e) {
    const fiatAmount = parseFloat(this.refs.fiatAmount.getValue())
    const conversionRate = this.state.currentRate.rates[this.state.selectedFiatType];
    console.log(fiatAmount, conversionRate)
    if(conversionRate && fiatAmount >= 0) {
      this.setState({ 
        maxAmount: fiatAmount / conversionRate,
        fiatAmount: fiatAmount
      })
    }
  }

  setFiatAmount(e) {
    const maxAmount = parseFloat(this.refs.maxAmount.getValue())
    const conversionRate = this.state.currentRate.rates[this.state.selectedFiatType];

    if(conversionRate && maxAmount >= 0) {
      this.setState({ 
        fiatAmount: maxAmount * conversionRate,
        maxAmount: maxAmount
      })
    }
  } 

  changeSelectedFiat(fiatType) {
    const conversionRate = this.state.currentRate.rates[fiatType];
    this.setState({ 
      maxAmount: this.state.fiatAmount / conversionRate,
      selectedFiatType: fiatType
    })    
  }  


  render() {
    const { isNew, isProposed, history } = this.props;
    const {
      isLoading,
      isSaving,
      title,
      description,
      image,
      recipientAddress,
      reviewerAddress,
      formIsValid,
      maxAmount,
      campaignTitle,
      hasWhitelist,
      whitelistReviewerOptions,
      projectId,
      items,
      itemizeState,
      conversionRates,
      fiatAmount,
      date,
      selectedFiatType,
      fiatTypes,
      currentRate
    } = this.state;

    return (
      <div id="edit-milestone-view">
        <div className="container-fluid page-layout edit-view">
          <div>
            <div className="col-md-8 m-auto">
              {isLoading && <Loader className="fixed" />}

              {!isLoading && (
                <div>
                  <GoBackButton history={history} />

                  <div className="form-header">
                    {isNew && !isProposed && <h3>Add a new milestone</h3>}

                    {!isNew && !isProposed && <h3>Edit milestone {title}</h3>}

                    {isNew && isProposed && <h3>Propose a Milestone</h3>}

                    <h6>
                      Campaign:{' '}
                      <strong>{getTruncatedText(campaignTitle, 100)}</strong>
                    </h6>

                    <p>
                      <i className="fa fa-question-circle" />
                      A Milestone is a single accomplishment within a project.
                      In the end, all donations end up in Milestones. Once your
                      Milestone is completed, you can request a payout.
                    </p>

                    {isProposed && (
                      <p>
                        <i className="fa fa-exclamation-triangle" />
                        You are proposing a Milestone to the Campaign Owner. The
                        Campaign Owner can accept or reject your Milestone
                      </p>
                    )}
                  </div>

                  <Form
                    onSubmit={this.submit}
                    mapping={inputs => this.mapInputs(inputs)}
                    onValid={() => this.toggleFormValid(true)}
                    onInvalid={() => this.toggleFormValid(false)}
                    layout="vertical"
                  >
                    <Input
                      name="title"
                      label="What are you going to accomplish in this Milestone?"
                      id="title-input"
                      type="text"
                      value={title}
                      placeholder="E.g. buying goods"
                      help="Describe your Milestone in 1 sentence."
                      validations="minLength:3"
                      validationErrors={{
                        minLength: 'Please provide at least 3 characters.',
                      }}
                      required
                      autoFocus
                    />

                    <div className="form-group">
                      <QuillFormsy
                        name="description"
                        label="Explain how you are going to do this successfully."
                        helpText="Make it as extensive as necessary. Your goal is to build trust,
                        so that people donate Ether to your Campaign. Don't hesitate to add a detailed budget for this Milestone"
                        value={description}
                        placeholder="Describe how you're going to execute your Milestone successfully
                        ..."
                        onTextChanged={content =>
                          this.constructSummary(content)
                        }
                        validations="minLength:3"
                        help="Describe your Milestone."
                        validationErrors={{
                          minLength: 'Please provide at least 3 characters.',
                        }}
                        required
                      />
                    </div>

                    <div className="form-group">
                      <FormsyImageUploader
                        setImage={this.setImage}
                        previewImage={image}
                        required={isNew}
                      />
                    </div>

                    <div className="form-group">
                      {hasWhitelist && (
                        <SelectFormsy
                          name="reviewerAddress"
                          id="reviewer-select"
                          label="Select a reviewer"
                          helpText="Each milestone needs a reviewer who verifies that the milestone is
                          completed successfully"
                          value={reviewerAddress}
                          cta="--- Select a reviewer ---"
                          options={whitelistReviewerOptions}
                          validations="isEtherAddress"
                          validationErrors={{
                            isEtherAddress: 'Please select a reviewer.',
                          }}
                          required
                          disabled={!isNew && !isProposed}
                        />
                      )}

                      {!hasWhitelist && (
                        <Input
                          name="reviewerAddress"
                          id="title-input"
                          label="Each Milestone needs a Reviewer who verifies that the Milestone is
                          completed successfully"
                          type="text"
                          value={reviewerAddress}
                          placeholder="0x0000000000000000000000000000000000000000"
                          validations="isEtherAddress"
                          validationErrors={{
                            isEtherAddress:
                              'Please insert a valid Ethereum address.',
                          }}
                          required
                        />
                      )}
                    </div>

                    <div className="form-group">
                      <Input
                        name="recipientAddress"
                        id="title-input"
                        label="Where will the money go after completion?"
                        type="text"
                        value={recipientAddress}
                        placeholder="0x0000000000000000000000000000000000000000"
                        help="Enter an Ethereum address."
                        validations="isEtherAddress"
                        validationErrors={{
                          isEtherAddress:
                            'Please insert a valid Ethereum address.',
                        }}
                        required
                        disabled={projectId}
                      />
                    </div>

                    {/*
                    <div className="form-group">
                      <DatePickerFormsy
                        name="completionDeadline"
                        label="Until what date is the Milestone achievable?"
                        type="text"
                        value={completionDeadline}
                        changeDate={date => this.changeDate(date)}
                        placeholder="Select a date"
                        help="Select a date"
                        validations="minLength:10"
                        validationErrors={{
                          minLength: 'Please provide a date.',
                        }}
                        required
                      />
                    </div>
                  */}

                    <Toggle
                      id='itemize-state'
                      defaultChecked={this.state.itemizeState}
                      onChange={()=>this.toggleItemize()} />
                    <label htmlFor='itemize-state'>Itemize milestone</label>

                    { !itemizeState &&
                      <span>
                        <div className="form-group row">
                          <div className="col-12">
                            <DatePickerFormsy
                              name="date"
                              type="text"
                              value={date}
                              startDate={date}
                              label="Milestone date"
                              changeDate={date => this.setDate(date)}
                              placeholder="Select a date"
                              help="Select a date"
                              validations="minLength:8"
                              validationErrors={{
                                minLength: 'Please provide a date.',
                              }}
                              required
                            />
                          </div>
                        </div>

                        <div className="form-group row">
                          <div className="col-4">
                            <Input
                              name="fiatAmount"
                              id="fiatamount-input"
                              type="number"
                              ref="fiatAmount"
                              label="Maximum amount in fiat"
                              value={fiatAmount}
                              placeholder="10"
                              validations="greaterThan:1"
                              validationErrors={{
                                greaterThan: 'Minimum value must be at least 1',
                              }}
                              disabled={projectId}
                              onKeyUp={this.setMaxAmount}                
                            />
                          </div>

                          <div className="col-4">
                            <SelectFormsy
                              name="fiatType"
                              label="Currency"
                              value={selectedFiatType}
                              options={fiatTypes}
                              onChange={this.changeSelectedFiat}
                              helpText={`1 Eth = ${currentRate.rates[selectedFiatType]} ${selectedFiatType}`}
                              required
                            /> 
                          </div>                          

                          <div className="col-4">
                            <Input
                              name="maxAmount"
                              id="maxamount-input"
                              type="number"
                              ref="maxAmount"
                              label="Maximum amount in &#926;"
                              value={maxAmount}
                              placeholder="10"
                              validations="greaterThan:0.0099999999999"
                              validationErrors={{
                                greaterThan: 'Minimum value must be at least Ξ 0.1',
                              }}
                              required
                              disabled={projectId}
                              onKeyUp={this.setFiatAmount}                
                            />
                          </div>
                        </div>
                      </span>
                    }

                    { itemizeState && 
                      <div className="form-group row">
                        <div className="col-12">
                          <table className="table table-responsive table-hover">
                            <thead>
                              <tr>
                                <th className="td-item-date">Date</th>                        
                                <th className="td-item-description">Description</th>
                                <th className="td-item-amount-fiat">Amount Fiat</th>
                                <th className="td-item-fiat-amount">Amount Ether</th>
                                <th className="td-item-file-upload">Attached proof</th>
                                <th className="td-item-action"></th>                          
                              </tr>
                            </thead>
                            <tbody>
                              {items.map((item, i) => (
                                <MilestoneItem 
                                  key={i}
                                  index={i}
                                  item={item}
                                  removeItem={()=>this.removeItem(i)}
                                />
                              ))}
                            </tbody>
                          </table>
                          <AddMilestoneItem 
                            onAddItem={(item)=>this.addItem(item)} 
                            conversionRate={conversionRates[0]}
                            getEthConversion={(date)=>this.getEthConversion(date)}
                          />
                        </div>
                      </div>
                    }

                    <div className="form-group row">
                      <div className="col-6">
                        <GoBackButton history={history} />
                      </div>
                      <div className="col-6">
                        <LoaderButton
                          className="btn btn-success pull-right"
                          formNoValidate
                          type="submit"
                          disabled={isSaving || !formIsValid}
                          isLoading={isSaving}
                          loadingText="Saving..."
                        >
                          <span>{this.btnText()}</span>
                        </LoaderButton>
                      </div>
                    </div>
                  </Form>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }
}

EditMilestone.propTypes = {
  currentUser: PropTypes.instanceOf(User).isRequired,
  history: PropTypes.shape({
    goBack: PropTypes.func.isRequired,
    push: PropTypes.func.isRequired,
  }).isRequired,
  isProposed: PropTypes.bool,
  isNew: PropTypes.bool,
  wallet: PropTypes.instanceOf(GivethWallet).isRequired,
  match: PropTypes.shape({
    params: PropTypes.shape({
      id: PropTypes.string,
      milestoneId: PropTypes.string,
    }).isRequired,
  }).isRequired,
};

EditMilestone.defaultProps = {
  isNew: false,
  isProposed: false,
};

export default EditMilestone;
